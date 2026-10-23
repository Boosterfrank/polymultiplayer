import { MSG, decodeCarBatch, relayFromBatch } from "../../shared/protocol.js";
import { scoreRound, placementsByPoints } from "./rules.js";
import { publicTrack, pickTrack } from "./tracks.js";
import { defaultClock } from "./match.js";

export const CUP_PHASE = Object.freeze({
  IDLE: "idle", // waiting for enough racers
  STARTING: "starting", // enough racers; the first round starts shortly
  COUNTDOWN: "countdown",
  RACING: "racing",
  CLOSING: "closing",
  RESULTS: "results",
  COMPLETE: "complete", // someone won; the next cup starts after the break
});

const IN_ROUND = new Set([CUP_PHASE.COUNTDOWN, CUP_PHASE.RACING, CUP_PHASE.CLOSING]);

/**
 * The always-on Quickplay Cup: one lobby that never closes. Players join and leave whenever they
 * like, rounds run on a schedule as long as enough racers are present, every few rounds a new
 * random track is drawn, places score points and the first player at the target wins; after a
 * short break the standings reset and the next cup starts by itself.
 *
 * It speaks the same messages as a ranked match (match_found, round_start, records, round_end,
 * player_left, ...) plus cup_state / cup_end, so the client drives it with its match controller.
 * Like `Match` it never touches sockets: `io.send`, `io.sendBinary`, `io.getPing` and
 * `io.onPlayerRemoved(cup, playerId)` are injected.
 */
export class Cup {
  /**
   * @param {object} args
   * @param {string} [args.id]
   * @param {object} args.cfg full server config (uses cfg.cup and cfg.rounds)
   * @param {object[]} args.pool track pool
   * @param {object} args.io
   * @param {object} [args.clock]
   * @param {object} [args.log]
   * @param {() => number} [args.rng]
   */
  constructor({ id = "cup", cfg, pool, io, clock = defaultClock, log = console, rng = Math.random }) {
    this.id = id;
    this.cfg = cfg;
    this.rules = cfg.cup;
    this.pool = pool;
    this.io = io;
    this.clock = clock;
    this.log = log;
    this.rng = rng;
    this.queueId = "cup";
    this.phase = CUP_PHASE.IDLE;
    /** @type {Map<string, object>} playerId -> member */
    this.members = new Map();
    /** Points of the current cup, kept by player id so a returning racer continues where they left. */
    this.scores = new Map();
    this.cupNumber = 0;
    this.cupsCompleted = 0;
    this.round = 0; // rounds played in the current cup
    this.trackRounds = 0; // rounds played on the current track
    this.track = null;
    this.usedTrackIds = [];
    this.sessionId = 0;
    this.startsAt = 0;
    this.endsAt = 0;
    this.roundEndedAt = 0;
    this.nextAt = 0; // when the next round / cup starts (starting, results, complete)
    this.records = new Map(); // slot -> frames
    this.racing = new Set(); // slots taking part in the current round
    this.roundHistory = [];
    this.lastWinner = null;
    this._timer = null;
    this._graceTimers = new Map();
    this._idleTimer = null;
    this.createdAt = clock.now();
  }

  // ---------------------------------------------------------------- helpers

  get players() {
    return [...this.members.values()];
  }

  get connectedPlayers() {
    return this.players.filter((p) => p.connected);
  }

  /** Racers who can take part in the next round. */
  get eligiblePlayers() {
    return this.players.filter((p) => p.connected && p.loaded);
  }

  send(player, msg) {
    if (player.connected) this.io.send(player.id, { ...msg, matchId: this.id });
  }

  broadcast(msg) {
    for (const p of this.members.values()) this.send(p, msg);
  }

  serverMessage(text) {
    this.broadcast({ type: MSG.SERVER_MESSAGE, text });
  }

  pointsOf(p) {
    return this.scores.get(p.id) ?? 0;
  }

  pointsBySlot() {
    const points = {};
    for (const p of this.members.values()) points[p.slot] = this.pointsOf(p);
    return points;
  }

  publicPlayer(p) {
    return {
      slot: p.slot,
      id: p.id,
      nickname: p.nickname,
      countryCode: p.countryCode,
      carStyle: p.carStyle,
      team: null,
      rating: null,
      division: null,
      active: true,
      connected: p.connected,
      racing: this.racing.has(p.slot),
      points: this.pointsOf(p),
    };
  }

  format() {
    return {
      scoring: "points",
      teams: null,
      teamSize: null,
      roundsToWin: null,
      maxRounds: null,
      pointsTable: this.rules.pointsTable,
      trackPerRound: false,
      cup: true,
      target: this.rules.target,
      roundsPerTrack: this.rules.roundsPerTrack,
    };
  }

  scoresInfo() {
    return { roundsPlayed: this.round, roundWins: null, points: this.pointsBySlot() };
  }

  standings() {
    const slots = this.players.map((p) => p.slot);
    const places = placementsByPoints(this.pointsBySlot(), slots);
    return this.players
      .map((p) => ({ slot: p.slot, id: p.id, nickname: p.nickname, points: this.pointsOf(p), place: places.get(p.slot) ?? null, connected: p.connected }))
      .sort((a, b) => b.points - a.points || a.slot - b.slot);
  }

  /** Everything a client (or /api/cup) needs to describe the lobby. */
  publicState() {
    return {
      enabled: true,
      id: this.id,
      name: this.rules.name,
      phase: this.phase,
      cupNumber: this.cupNumber,
      cupsCompleted: this.cupsCompleted,
      round: this.round,
      trackRounds: this.trackRounds,
      roundsPerTrack: this.rules.roundsPerTrack,
      target: this.rules.target,
      pointsTable: this.rules.pointsTable,
      minPlayers: this.rules.minPlayers,
      maxPlayers: this.rules.maxPlayers,
      track: publicTrack(this.upcomingTrack()),
      players: this.players.map((p) => this.publicPlayer(p)),
      standings: this.standings(),
      startsAt: IN_ROUND.has(this.phase) ? this.startsAt : null,
      endsAt: IN_ROUND.has(this.phase) ? this.endsAt : null,
      nextAt: this.phase === CUP_PHASE.STARTING || this.phase === CUP_PHASE.RESULTS || this.phase === CUP_PHASE.COMPLETE ? this.nextAt : null,
      lastWinner: this.lastWinner,
      serverTime: this.clock.now(),
    };
  }

  baseInfo() {
    return {
      matchId: this.id,
      queueId: this.queueId,
      queueName: this.rules.name,
      format: this.format(),
      players: this.players.map((p) => this.publicPlayer(p)),
      track: publicTrack(this.upcomingTrack()),
      countdownSeconds: this.cfg.rounds.countdownSeconds,
      readyTimeoutSeconds: this.cfg.rounds.readyTimeoutSeconds,
      cup: this.publicState(),
    };
  }

  snapshot() {
    const records = {};
    for (const [slot, f] of this.records) records[slot] = f;
    return {
      ...this.baseInfo(),
      phase: IN_ROUND.has(this.phase) || this.phase === CUP_PHASE.RESULTS ? this.phase : "loading",
      round: IN_ROUND.has(this.phase) || this.phase === CUP_PHASE.RESULTS ? this.round : 0,
      sessionId: this.sessionId,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      scores: this.scoresInfo(),
      records,
      rounds: this.roundHistory.slice(-20),
    };
  }

  makeSessionId(round) {
    return (((0xcc00 + (this.cupNumber & 0xff)) << 16) | (round & 0xffff)) >>> 0;
  }

  setTimer(fn, ms) {
    this.clearTimer();
    this._timer = this.clock.setTimeout(() => {
      this._timer = null;
      try {
        fn();
      } catch (err) {
        this.log.error(`[cup] timer error`, err);
      }
    }, Math.max(0, ms));
  }

  clearTimer() {
    if (this._timer) {
      this.clock.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  freeSlot() {
    const used = new Set(this.players.map((p) => p.slot));
    for (let slot = 1; slot < 256; slot++) if (!used.has(slot)) return slot;
    return null;
  }

  /** The track the next round is raced on (drawn ahead of time so clients can preload it). */
  upcomingTrack() {
    if (this.track && (IN_ROUND.has(this.phase) || this.trackRounds < this.rules.roundsPerTrack)) return this.track;
    if (!this._peekedTrack) {
      const recent = this.usedTrackIds.slice(-3);
      this._peekedTrack = pickTrack(this.pool, Infinity, recent, this.rng);
      if (!this._peekedTrack) throw new Error("the cup has no tracks");
    }
    return this._peekedTrack;
  }

  /** Make the upcoming track the current one (new track block). */
  pickNextTrack() {
    this.track = this.upcomingTrack();
    this._peekedTrack = null;
    this.trackRounds = 0;
    this.usedTrackIds.push(this.track.id);
    if (this.usedTrackIds.length > 16) this.usedTrackIds.shift();
    return this.track;
  }

  // ---------------------------------------------------------------- membership

  /**
   * @param {{id:string, nickname:string, countryCode:string|null, carStyle:string|null}} info
   * @returns {{ok: true} | {ok: false, code: string, message: string}}
   */
  join(info) {
    const existing = this.members.get(info.id);
    if (existing) {
      // Re-joining from the same connection: just resend the state.
      existing.connected = true;
      this.send(existing, { type: MSG.MATCH_FOUND, ...this.baseInfo(), you: existing.slot });
      return { ok: true };
    }
    if (this.members.size >= this.rules.maxPlayers) return { ok: false, code: "cup_full", message: `The cup is full (${this.rules.maxPlayers} racers)` };
    const slot = this.freeSlot();
    if (slot == null) return { ok: false, code: "cup_full", message: "The cup is full" };
    if (this._idleTimer) {
      this.clock.clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    const p = {
      id: info.id,
      nickname: info.nickname,
      countryCode: info.countryCode ?? null,
      carStyle: info.carStyle ?? null,
      slot,
      connected: true,
      loaded: false,
      joinedAt: this.clock.now(),
      resetCounter: 0,
    };
    this.members.set(p.id, p);
    if (!this.scores.has(p.id)) this.scores.set(p.id, 0);
    this.send(p, { type: MSG.MATCH_FOUND, ...this.baseInfo(), you: slot });
    this.serverMessage(`"${p.nickname}" joined the cup${this.pointsOf(p) ? ` (${this.pointsOf(p)} pts)` : ""}`);
    this.broadcastState();
    return { ok: true };
  }

  /** The player has loaded the track (match_ready). */
  ready(playerId) {
    const p = this.members.get(playerId);
    if (!p) return;
    p.loaded = true;
    this.maybeStart();
    this.broadcastState();
  }

  leave(playerId) {
    const p = this.members.get(playerId);
    if (!p) return;
    this.removePlayer(p, "left");
  }

  disconnected(playerId) {
    const p = this.members.get(playerId);
    if (!p) return;
    p.connected = false;
    this.broadcast({ type: MSG.PLAYER_STATUS, slot: p.slot, connected: false });
    if (this.phase === CUP_PHASE.STARTING && this.eligiblePlayers.length < this.rules.minPlayers) {
      this.clearTimer();
      this.phase = CUP_PHASE.IDLE;
      this.nextAt = 0;
    }
    this.broadcastState();
    const t = this.clock.setTimeout(() => {
      this._graceTimers.delete(p.id);
      if (!p.connected && this.members.get(p.id) === p) this.removePlayer(p, "disconnected");
    }, this.cfg.rounds.disconnectGraceSeconds * 1000);
    this._graceTimers.set(p.id, t);
    if (this.phase === CUP_PHASE.RACING) this.maybeShortenRound();
  }

  reconnected(playerId) {
    const p = this.members.get(playerId);
    if (!p) return false;
    const t = this._graceTimers.get(p.id);
    if (t) {
      this.clock.clearTimeout(t);
      this._graceTimers.delete(p.id);
    }
    p.connected = true;
    this.send(p, { type: MSG.MATCH_RESUME, ...this.snapshot(), you: p.slot });
    this.broadcast({ type: MSG.PLAYER_STATUS, slot: p.slot, connected: true });
    this.maybeStart();
    this.broadcastState();
    return true;
  }

  removePlayer(p, reason) {
    if (this.members.get(p.id) !== p) return;
    this.members.delete(p.id);
    this.records.delete(p.slot);
    this.racing.delete(p.slot);
    const t = this._graceTimers.get(p.id);
    if (t) {
      this.clock.clearTimeout(t);
      this._graceTimers.delete(p.id);
    }
    this.broadcast({ type: MSG.PLAYER_LEFT, slot: p.slot, reason });
    this.serverMessage(`"${p.nickname}" left the cup`);
    this.io.onPlayerRemoved?.(this, p.id);
    if (this.members.size === 0) {
      this.onEmpty();
      return;
    }
    if (this.phase === CUP_PHASE.STARTING && this.eligiblePlayers.length < this.rules.minPlayers) {
      this.clearTimer();
      this.phase = CUP_PHASE.IDLE;
      this.nextAt = 0;
    } else if (this.phase === CUP_PHASE.RACING) {
      this.maybeShortenRound();
    }
    this.broadcastState();
  }

  onEmpty() {
    this.clearTimer();
    this.racing.clear();
    this.records.clear();
    const wasInRound = IN_ROUND.has(this.phase) || this.phase === CUP_PHASE.RESULTS || this.phase === CUP_PHASE.STARTING;
    this.phase = CUP_PHASE.IDLE;
    this.nextAt = 0;
    if (wasInRound) this.log.info?.(`[cup] everyone left during cup ${this.cupNumber}; standings kept for ${this.rules.idleResetSeconds}s`);
    if (this._idleTimer) this.clock.clearTimeout(this._idleTimer);
    this._idleTimer = this.clock.setTimeout(() => {
      this._idleTimer = null;
      if (this.members.size === 0) this.resetCup();
    }, this.rules.idleResetSeconds * 1000);
  }

  broadcastState() {
    this.broadcast({ type: MSG.CUP_STATE, cup: this.publicState() });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Enough loaded racers and nothing running: schedule the next round. */
  maybeStart() {
    if (this.phase !== CUP_PHASE.IDLE) return;
    if (this.eligiblePlayers.length < this.rules.minPlayers) return;
    this.phase = CUP_PHASE.STARTING;
    const wait = this.rules.waitSeconds * 1000;
    this.nextAt = this.clock.now() + wait;
    if (this.round === 0) {
      this.cupNumber += 1;
      this.serverMessage(`Cup #${this.cupNumber} starts in ${this.rules.waitSeconds} s – first to ${this.rules.target} points wins`);
    } else {
      this.serverMessage(`The cup continues in ${this.rules.waitSeconds} s`);
    }
    this.setTimer(() => this.startRound(), wait);
  }

  startRound() {
    if (this.eligiblePlayers.length < this.rules.minPlayers) {
      this.phase = CUP_PHASE.IDLE;
      this.nextAt = 0;
      this.serverMessage("Waiting for more racers…");
      this.broadcastState();
      return;
    }
    if (!this.track || this.trackRounds >= this.rules.roundsPerTrack) this.pickNextTrack();
    this.round += 1;
    this.trackRounds += 1;
    this.sessionId = this.makeSessionId(this.round);
    this.records.clear();
    this.racing = new Set(this.eligiblePlayers.map((p) => p.slot));
    for (const p of this.members.values()) p.resetCounter = 0;
    const now = this.clock.now();
    const roundSeconds = this.track.roundSeconds ?? this.cfg.rounds.defaultRoundSeconds;
    this.startsAt = now + this.cfg.rounds.countdownSeconds * 1000;
    this.endsAt = this.startsAt + roundSeconds * 1000;
    this.nextAt = 0;
    this.phase = CUP_PHASE.COUNTDOWN;
    this.broadcast({
      type: MSG.ROUND_START,
      round: this.round,
      sessionId: this.sessionId,
      track: publicTrack(this.track),
      trackRound: this.trackRounds,
      roundsPerTrack: this.rules.roundsPerTrack,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      countdownSeconds: this.cfg.rounds.countdownSeconds,
      scores: this.scoresInfo(),
      players: this.players.map((p) => this.publicPlayer(p)),
      cup: this.publicState(),
    });
    this.setTimer(() => this.onRaceStart(), this.startsAt - now);
  }

  onRaceStart() {
    if (this.phase !== CUP_PHASE.COUNTDOWN) return;
    this.phase = CUP_PHASE.RACING;
    this.setTimer(() => this.onRoundClockExpired(), this.endsAt - this.clock.now());
  }

  onRoundClockExpired() {
    if (this.phase !== CUP_PHASE.RACING) return;
    this.phase = CUP_PHASE.CLOSING;
    this.roundEndedAt = this.clock.now();
    this.setTimer(() => this.endRound(), this.cfg.rounds.lateRecordGraceMs);
  }

  record(playerId, sessionId, frames) {
    const p = this.members.get(playerId);
    if (!p || !this.racing.has(p.slot)) return;
    if (sessionId !== this.sessionId) return;
    if (!Number.isInteger(frames) || frames <= 0 || frames > 6_000_000) return;
    const now = this.clock.now();
    const racing = this.phase === CUP_PHASE.RACING || (this.phase === CUP_PHASE.CLOSING && now - this.roundEndedAt <= this.cfg.rounds.lateRecordGraceMs);
    if (!racing) return;
    if (frames > now - this.startsAt + 2500) return;
    const prev = this.records.get(p.slot);
    if (prev != null && prev <= frames) return;
    this.records.set(p.slot, frames);
    const records = {};
    for (const [slot, f] of this.records) records[slot] = f;
    this.broadcast({ type: MSG.RECORDS, sessionId: this.sessionId, records });
    this.maybeShortenRound();
  }

  maybeShortenRound() {
    if (this.phase !== CUP_PHASE.RACING) return;
    const racers = this.players.filter((p) => this.racing.has(p.slot) && p.connected);
    if (racers.length === 0 || !racers.every((p) => this.records.has(p.slot))) return;
    const now = this.clock.now();
    const newEnd = now + this.cfg.rounds.finishGraceSeconds * 1000;
    if (newEnd < this.endsAt) {
      this.endsAt = newEnd;
      this.broadcast({ type: MSG.ROUND_CLOCK, sessionId: this.sessionId, endsAt: this.endsAt });
      this.setTimer(() => this.onRoundClockExpired(), this.endsAt - now);
    }
  }

  endRound() {
    this.phase = CUP_PHASE.RESULTS;
    const racers = this.players.filter((p) => this.racing.has(p.slot));
    const entries = racers.map((p) => ({ slot: p.slot, frames: this.records.get(p.slot) ?? null, team: null }));
    const result = scoreRound({ scoring: "points", pointsTable: this.rules.pointsTable, entries });
    for (const p of racers) this.scores.set(p.id, this.pointsOf(p) + (result.points[p.slot] ?? 0));
    const results = result.ranked.map((r) => ({ slot: r.slot, frames: r.frames, position: r.position, points: result.points[r.slot] ?? 0 }));
    this.roundHistory.push({ cup: this.cupNumber, round: this.round, trackId: this.track.id, results, roundWinner: result.roundWinner });
    if (this.roundHistory.length > 100) this.roundHistory.shift();

    const winner = this.findWinner();
    const nextRoundIn = winner ? null : this.cfg.rounds.resultsSeconds * 1000;
    const switching = this.trackRounds >= this.rules.roundsPerTrack;
    const nextTrack = !winner && switching ? publicTrack(this.upcomingTrack()) : null;
    this.nextAt = this.clock.now() + (winner ? this.rules.breakSeconds * 1000 : nextRoundIn);
    this.broadcast({
      type: MSG.ROUND_END,
      round: this.round,
      sessionId: this.sessionId,
      results,
      roundWinner: result.roundWinner,
      teamPoints: null,
      scores: this.scoresInfo(),
      nextRoundIn,
      nextTrack,
      matchOver: false,
      cupOver: !!winner,
    });
    if (winner) this.completeCup(winner);
    else this.setTimer(() => this.startRound(), nextRoundIn);
    this.broadcastState();
  }

  findWinner() {
    let best = -1;
    let leaders = [];
    for (const p of this.members.values()) {
      const pts = this.pointsOf(p);
      if (pts > best) {
        best = pts;
        leaders = [p];
      } else if (pts === best) leaders.push(p);
    }
    if (best >= this.rules.target && leaders.length === 1) return leaders[0];
    return null;
  }

  completeCup(winner) {
    this.phase = CUP_PHASE.COMPLETE;
    this.cupsCompleted += 1;
    const standings = this.standings();
    this.lastWinner = { id: winner.id, nickname: winner.nickname, points: this.pointsOf(winner), cupNumber: this.cupNumber, rounds: this.round, finishedAt: this.clock.now() };
    this.log.info?.(`[cup] cup #${this.cupNumber} won by ${winner.nickname} with ${this.pointsOf(winner)} points after ${this.round} rounds`);
    this.io.onCupFinished?.(this, { cupNumber: this.cupNumber, winner: this.lastWinner, standings, rounds: this.round, trackIds: this.usedTrackIds.slice(), finishedAt: this.clock.now() });
    // The next cup starts on a fresh track; tell everyone now so they can preload it.
    this.trackRounds = this.rules.roundsPerTrack;
    this.broadcast({
      type: MSG.CUP_END,
      cupNumber: this.cupNumber,
      winner: { type: "player", slot: winner.slot, id: winner.id, nickname: winner.nickname, points: this.pointsOf(winner) },
      standings,
      scores: this.scoresInfo(),
      rounds: this.round,
      nextCupIn: this.rules.breakSeconds * 1000,
      nextAt: this.nextAt,
      nextTrack: publicTrack(this.upcomingTrack()),
      players: this.players.map((p) => this.publicPlayer(p)),
    });
    this.setTimer(() => this.nextCup(), this.rules.breakSeconds * 1000);
  }

  nextCup() {
    this.resetCup();
    this.broadcastState();
    this.maybeStart();
  }

  /** Forget the standings and start from round 1 (next track) when racers are around. */
  resetCup() {
    this.scores.clear();
    for (const p of this.members.values()) this.scores.set(p.id, 0);
    this.round = 0;
    this.trackRounds = this.rules.roundsPerTrack; // forces a fresh track for round 1
    this.records.clear();
    this.racing.clear();
    this.phase = CUP_PHASE.IDLE;
    this.nextAt = 0;
  }

  // ---------------------------------------------------------------- car relay

  carBatch(playerId, bytes) {
    const p = this.members.get(playerId);
    if (!p || !this.racing.has(p.slot)) return;
    if (!IN_ROUND.has(this.phase)) return;
    let header;
    try {
      header = decodeCarBatch(bytes);
    } catch {
      return;
    }
    if (header.sessionId !== this.sessionId) return;
    if (header.resetCounter > p.resetCounter) p.resetCounter = header.resetCounter;
    const relay = relayFromBatch(p.slot, bytes);
    for (const q of this.members.values()) {
      if (q !== p && q.connected && this.racing.has(q.slot)) this.io.sendBinary(q.id, relay);
    }
  }

  carReset(playerId, sessionId, resetCounter) {
    const p = this.members.get(playerId);
    if (!p || !this.racing.has(p.slot) || sessionId !== this.sessionId) return;
    if (!Number.isInteger(resetCounter) || resetCounter < 0) return;
    if (resetCounter > p.resetCounter) p.resetCounter = resetCounter;
    for (const q of this.members.values()) {
      if (q !== p && this.racing.has(q.slot)) this.send(q, { type: MSG.CAR_RESET, sessionId, slot: p.slot, resetCounter });
    }
  }

  pingsMessage() {
    const pings = {};
    for (const p of this.members.values()) {
      if (p.connected) pings[p.slot] = this.io.getPing?.(p.id) ?? null;
    }
    return { type: MSG.PINGS, pings };
  }

  destroy() {
    this.clearTimer();
    for (const t of this._graceTimers.values()) this.clock.clearTimeout(t);
    this._graceTimers.clear();
    if (this._idleTimer) this.clock.clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }
}
