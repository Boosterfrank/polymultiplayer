import { MSG, decodeCarBatch, relayFromBatch } from "../../shared/protocol.js";
import { scoreRound, evaluateMatch, placementsByPoints } from "./rules.js";
import { computeRatingChanges, divisionFor } from "./rating.js";
import { publicTrack, pickTrack } from "./tracks.js";

export const PHASE = Object.freeze({
  LOADING: "loading",
  COUNTDOWN: "countdown",
  RACING: "racing",
  CLOSING: "closing",
  RESULTS: "results",
  FINISHED: "finished",
});

export const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

/**
 * One ranked match: a sequence of rounds (= game sessions) on one track.
 *
 * The match never talks to sockets directly; `io.send(playerId, msg)`,
 * `io.sendBinary(playerId, bytes)`, `io.getPing(playerId)` and
 * `io.onFinished(match, summary)` are injected, which keeps it testable.
 */
export class Match {
  /**
   * @param {object} args
   * @param {string} args.id
   * @param {number} args.seq global match counter (used for session ids)
   * @param {string} args.queueId
   * @param {object} args.queue queue config
   * @param {object} args.cfg full server config
   * @param {Array<{id:string, nickname:string, countryCode:string|null, carStyle:string|null, team:number|null, rating:number, matches:number}>} args.players
   * @param {object} args.track pool track
   * @param {object[]} [args.pool] full track pool (for trackPerRound)
   * @param {object} args.io
   * @param {object} [args.clock]
   * @param {object} [args.log]
   */
  constructor({ id, seq, queueId, queue, cfg, players, track, pool = [], io, clock = defaultClock, log = console }) {
    this.id = id;
    this.seq = seq;
    this.queueId = queueId;
    this.queue = queue;
    this.cfg = cfg;
    this.io = io;
    this.clock = clock;
    this.log = log;
    this.scoring = queue.scoring;
    this.isTeamScoring = this.scoring === "duel" || this.scoring === "teams";
    this.track = track;
    this.pool = pool;
    this.usedTrackIds = [track.id];
    this.phase = PHASE.LOADING;
    this.round = 0;
    this.sessionId = 0;
    this.startsAt = 0;
    this.endsAt = 0;
    this.roundEndedAt = 0;
    this.records = new Map(); // slot -> frames (best in current round)
    this.roundHistory = [];
    this.roundWins = [0, 0];
    this.points = {};
    this.createdAt = clock.now();
    this.finishedSummary = null;
    this._timer = null;
    this._graceTimers = new Map();

    this.players = players.map((p, i) => ({
      ...p,
      slot: i + 1,
      ready: false,
      active: true,
      connected: true,
      resetCounter: 0,
    }));
    this.bySlot = new Map(this.players.map((p) => [p.slot, p]));
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    for (const p of this.players) this.points[p.slot] = 0;
  }

  // ---------------------------------------------------------------- helpers

  get activePlayers() {
    return this.players.filter((p) => p.active);
  }

  get activeSlots() {
    return new Set(this.activePlayers.map((p) => p.slot));
  }

  teamOfMap() {
    return new Map(this.players.map((p) => [p.slot, p.team]));
  }

  send(player, msg) {
    if (player.connected) this.io.send(player.id, { ...msg, matchId: this.id });
  }

  broadcast(msg, { includeInactive = false } = {}) {
    for (const p of this.players) {
      if (!p.active && !includeInactive) continue;
      this.send(p, msg);
    }
  }

  serverMessage(text) {
    this.broadcast({ type: MSG.SERVER_MESSAGE, text });
  }

  publicPlayer(p) {
    const div = divisionFor(p.rating, p.matches, this.cfg.rating);
    return {
      slot: p.slot,
      id: p.id,
      nickname: p.nickname,
      countryCode: p.countryCode,
      carStyle: p.carStyle,
      team: p.team,
      rating: p.rating,
      division: div.label,
      active: p.active,
      connected: p.connected,
    };
  }

  format() {
    return {
      scoring: this.scoring,
      teams: this.queue.teams ?? null,
      teamSize: this.queue.teamSize ?? null,
      roundsToWin: this.queue.roundsToWin ?? null,
      maxRounds: this.queue.maxRounds,
      pointsTable: this.queue.pointsTable ?? null,
      trackPerRound: !!this.cfg.trackPerRound,
    };
  }

  scores() {
    return {
      roundsPlayed: this.roundHistory.length,
      roundWins: this.isTeamScoring ? [...this.roundWins] : null,
      points: { ...this.points },
    };
  }

  baseInfo() {
    return {
      matchId: this.id,
      queueId: this.queueId,
      queueName: this.queue.name,
      format: this.format(),
      players: this.players.map((p) => this.publicPlayer(p)),
      track: publicTrack(this.track),
      countdownSeconds: this.cfg.rounds.countdownSeconds,
      readyTimeoutSeconds: this.cfg.rounds.readyTimeoutSeconds,
    };
  }

  makeSessionId(round) {
    return (((this.seq & 0xffffff) << 8) | (round & 0xff)) >>> 0;
  }

  setTimer(fn, ms) {
    this.clearTimer();
    this._timer = this.clock.setTimeout(() => {
      this._timer = null;
      try {
        fn();
      } catch (err) {
        this.log.error(`[match ${this.id}] timer error`, err);
      }
    }, Math.max(0, ms));
  }

  clearTimer() {
    if (this._timer) {
      this.clock.clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    for (const p of this.players) {
      this.send(p, { type: MSG.MATCH_FOUND, ...this.baseInfo(), you: p.slot });
    }
    this.setTimer(() => this.onReadyTimeout(), this.cfg.rounds.readyTimeoutSeconds * 1000);
  }

  ready(playerId) {
    const p = this.byId.get(playerId);
    if (!p || !p.active || this.phase !== PHASE.LOADING) return;
    p.ready = true;
    if (this.activePlayers.every((q) => q.ready)) {
      this.clearTimer();
      this.startRound(1);
    }
  }

  onReadyTimeout() {
    if (this.phase !== PHASE.LOADING) return;
    for (const p of this.activePlayers) {
      if (!p.ready) this.removePlayer(p, "timeout");
    }
    if (this.phase === PHASE.FINISHED) return;
    if (this.checkMatchOver()) return;
    this.startRound(1);
  }

  startRound(round) {
    if (this.phase === PHASE.FINISHED) return;
    this.round = round;
    this.sessionId = this.makeSessionId(round);
    this.records.clear();
    for (const p of this.players) p.resetCounter = 0;
    if (round > 1 && this.cfg.trackPerRound && this.pool.length > 0) {
      const next = pickTrack(this.pool, this.maxTier(), this.usedTrackIds);
      if (next) {
        this.track = next;
        this.usedTrackIds.push(next.id);
      }
    }
    const now = this.clock.now();
    const roundSeconds = this.track.roundSeconds ?? this.cfg.rounds.defaultRoundSeconds;
    this.startsAt = now + this.cfg.rounds.countdownSeconds * 1000;
    this.endsAt = this.startsAt + roundSeconds * 1000;
    this.phase = PHASE.COUNTDOWN;
    this.broadcast({
      type: MSG.ROUND_START,
      round,
      sessionId: this.sessionId,
      track: publicTrack(this.track),
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      countdownSeconds: this.cfg.rounds.countdownSeconds,
      scores: this.scores(),
      players: this.players.map((p) => this.publicPlayer(p)),
    });
    this.setTimer(() => this.onRaceStart(), this.startsAt - now);
  }

  maxTier() {
    let tier = Infinity;
    for (const p of this.activePlayers) {
      tier = Math.min(tier, divisionFor(p.rating, p.matches, this.cfg.rating).tier);
    }
    return Number.isFinite(tier) ? tier : 1;
  }

  onRaceStart() {
    if (this.phase !== PHASE.COUNTDOWN) return;
    this.phase = PHASE.RACING;
    this.setTimer(() => this.onRoundClockExpired(), this.endsAt - this.clock.now());
  }

  onRoundClockExpired() {
    if (this.phase !== PHASE.RACING) return;
    this.phase = PHASE.CLOSING;
    this.roundEndedAt = this.clock.now();
    this.setTimer(() => this.endRound(), this.cfg.rounds.lateRecordGraceMs);
  }

  /** A player finished a run (their session best). */
  record(playerId, sessionId, frames) {
    const p = this.byId.get(playerId);
    if (!p || !p.active) return;
    if (sessionId !== this.sessionId) return;
    if (!Number.isInteger(frames) || frames <= 0 || frames > 6_000_000) return;
    const now = this.clock.now();
    const racing = this.phase === PHASE.RACING || (this.phase === PHASE.CLOSING && now - this.roundEndedAt <= this.cfg.rounds.lateRecordGraceMs);
    if (!racing) return;
    // A run cannot be longer than the time elapsed since the round started (plus latency slack).
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
    if (this.phase !== PHASE.RACING) return;
    if (!this.activePlayers.every((p) => this.records.has(p.slot))) return;
    const now = this.clock.now();
    const newEnd = now + this.cfg.rounds.finishGraceSeconds * 1000;
    if (newEnd < this.endsAt) {
      this.endsAt = newEnd;
      this.broadcast({ type: MSG.ROUND_CLOCK, sessionId: this.sessionId, endsAt: this.endsAt });
      this.setTimer(() => this.onRoundClockExpired(), this.endsAt - now);
    }
  }

  endRound() {
    if (this.phase === PHASE.FINISHED) return;
    this.phase = PHASE.RESULTS;
    const entries = this.activePlayers.map((p) => ({ slot: p.slot, frames: this.records.get(p.slot) ?? null, team: p.team }));
    const result = scoreRound({ scoring: this.scoring, pointsTable: this.queue.pointsTable, entries });
    for (const [slot, pts] of Object.entries(result.points)) {
      this.points[slot] = (this.points[slot] ?? 0) + pts;
    }
    if (this.isTeamScoring && result.roundWinner?.type === "team") {
      this.roundWins[result.roundWinner.team] += 1;
    }
    const results = result.ranked.map((r) => ({ slot: r.slot, frames: r.frames, position: r.position, points: result.points[r.slot] ?? 0 }));
    const roundRecord = { round: this.round, trackId: this.track.id, results, roundWinner: result.roundWinner, teamPoints: result.teamPoints };
    this.roundHistory.push(roundRecord);

    const status = this.evaluate();
    const nextRoundIn = status.finished ? null : this.cfg.rounds.resultsSeconds * 1000;
    this.broadcast({
      type: MSG.ROUND_END,
      round: this.round,
      sessionId: this.sessionId,
      results,
      roundWinner: result.roundWinner,
      teamPoints: result.teamPoints,
      scores: this.scores(),
      nextRoundIn,
      matchOver: status.finished,
    });
    if (status.finished) {
      this.finish(status);
    } else {
      this.setTimer(() => this.startRound(this.round + 1), nextRoundIn);
    }
  }

  evaluate() {
    return evaluateMatch({
      scoring: this.scoring,
      roundsPlayed: this.roundHistory.length,
      roundsToWin: this.queue.roundsToWin,
      maxRounds: this.queue.maxRounds,
      roundWins: this.roundWins,
      totalPoints: this.points,
      teamOf: this.teamOfMap(),
      activeSlots: this.activeSlots,
    });
  }

  /** Returns true when the match ended because of forfeits. */
  checkMatchOver() {
    if (this.phase === PHASE.FINISHED) return true;
    const status = this.evaluate();
    if (status.finished) {
      this.finish(status);
      return true;
    }
    return false;
  }

  resultFor(p, winner) {
    if (!p.active) return "loss";
    if (winner == null) return "draw";
    if (winner.type === "team") return winner.team === p.team ? "win" : "loss";
    return winner.slot === p.slot ? "win" : "loss";
  }

  finish(status) {
    if (this.phase === PHASE.FINISHED) return;
    this.clearTimer();
    for (const t of this._graceTimers.values()) this.clock.clearTimeout(t);
    this._graceTimers.clear();
    this.phase = PHASE.FINISHED;
    const winner = status.winner;

    let participants;
    if (this.isTeamScoring) {
      participants = this.players.map((p) => ({ id: p.id, rating: p.rating, matches: p.matches, team: p.team, points: this.points[p.slot] ?? 0, place: null }));
    } else {
      // Leavers are placed last.
      const activeSlots = this.players.filter((p) => p.active).map((p) => p.slot);
      const places = placementsByPoints(this.points, activeSlots);
      const lastPlace = activeSlots.length + 1;
      participants = this.players.map((p) => ({ id: p.id, rating: p.rating, matches: p.matches, team: null, points: this.points[p.slot] ?? 0, place: p.active ? places.get(p.slot) : lastPlace }));
    }
    let winnerTeam = null;
    if (this.isTeamScoring) winnerTeam = winner?.type === "team" ? winner.team : null;
    const changes = computeRatingChanges({
      mode: this.isTeamScoring ? (this.scoring === "duel" ? "duel" : "teams") : "ffa",
      participants,
      winnerTeam,
      cfg: this.cfg.rating,
    });

    const ratings = {};
    const perPlayer = [];
    for (const p of this.players) {
      const ch = changes.get(p.id) ?? { before: p.rating, after: p.rating, delta: 0 };
      const result = this.resultFor(p, winner);
      const div = divisionFor(ch.after, p.matches + 1, this.cfg.rating);
      ratings[p.slot] = { before: ch.before, after: ch.after, delta: ch.delta, division: div.label, result };
      perPlayer.push({ id: p.id, slot: p.slot, delta: ch.delta, result });
    }

    this.finishedSummary = {
      id: this.id,
      queueId: this.queueId,
      startedAt: this.createdAt,
      finishedAt: this.clock.now(),
      trackIds: this.usedTrackIds,
      winner,
      reason: status.reason,
      scores: this.scores(),
      players: this.players.map((p) => ({ id: p.id, slot: p.slot, nickname: p.nickname, team: p.team, active: p.active, points: this.points[p.slot] ?? 0 })),
      rounds: this.roundHistory,
      ratings: perPlayer,
    };

    this.broadcast(
      { type: MSG.MATCH_END, winner, reason: status.reason, scores: this.scores(), rounds: this.roundHistory, ratings, players: this.players.map((p) => this.publicPlayer(p)) },
      { includeInactive: true },
    );
    this.io.onFinished?.(this, this.finishedSummary);
  }

  // ---------------------------------------------------------------- player events

  carBatch(playerId, bytes) {
    const p = this.byId.get(playerId);
    if (!p || !p.active) return;
    if (this.phase !== PHASE.RACING && this.phase !== PHASE.COUNTDOWN && this.phase !== PHASE.CLOSING) return;
    let header;
    try {
      header = decodeCarBatch(bytes);
    } catch {
      return;
    }
    if (header.sessionId !== this.sessionId) return;
    if (header.resetCounter > p.resetCounter) p.resetCounter = header.resetCounter;
    const relay = relayFromBatch(p.slot, bytes);
    for (const q of this.players) {
      if (q !== p && q.active && q.connected) this.io.sendBinary(q.id, relay);
    }
  }

  carReset(playerId, sessionId, resetCounter) {
    const p = this.byId.get(playerId);
    if (!p || !p.active || sessionId !== this.sessionId) return;
    if (!Number.isInteger(resetCounter) || resetCounter < 0) return;
    if (resetCounter > p.resetCounter) p.resetCounter = resetCounter;
    for (const q of this.players) {
      if (q !== p && q.active) this.send(q, { type: MSG.CAR_RESET, sessionId, slot: p.slot, resetCounter });
    }
  }

  /** Player explicitly left (Exit button, menu). Counts as a forfeit. */
  leave(playerId) {
    const p = this.byId.get(playerId);
    if (!p || !p.active) return;
    this.removePlayer(p, "left");
    this.checkMatchOver();
  }

  /** Socket closed: keep the seat for a grace period. */
  disconnected(playerId) {
    const p = this.byId.get(playerId);
    if (!p || !p.active) return;
    p.connected = false;
    this.broadcast({ type: MSG.PLAYER_STATUS, slot: p.slot, connected: false });
    if (this.phase === PHASE.FINISHED) return;
    const t = this.clock.setTimeout(() => {
      this._graceTimers.delete(p.id);
      if (!p.connected && p.active) {
        this.removePlayer(p, "disconnected");
        this.checkMatchOver();
      }
    }, this.cfg.rounds.disconnectGraceSeconds * 1000);
    this._graceTimers.set(p.id, t);
  }

  /** Player reconnected within the grace period. */
  reconnected(playerId) {
    const p = this.byId.get(playerId);
    if (!p || !p.active) return false;
    const t = this._graceTimers.get(p.id);
    if (t) {
      this.clock.clearTimeout(t);
      this._graceTimers.delete(p.id);
    }
    p.connected = true;
    this.send(p, { type: MSG.MATCH_RESUME, ...this.snapshot(), you: p.slot });
    this.broadcast({ type: MSG.PLAYER_STATUS, slot: p.slot, connected: true });
    return true;
  }

  snapshot() {
    const records = {};
    for (const [slot, f] of this.records) records[slot] = f;
    return {
      ...this.baseInfo(),
      phase: this.phase,
      round: this.round,
      sessionId: this.sessionId,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      scores: this.scores(),
      records,
      rounds: this.roundHistory,
    };
  }

  removePlayer(p, reason) {
    if (!p.active) return;
    p.active = false;
    p.connected = false;
    p.ready = false;
    this.records.delete(p.slot);
    const t = this._graceTimers.get(p.id);
    if (t) {
      this.clock.clearTimeout(t);
      this._graceTimers.delete(p.id);
    }
    this.broadcast({ type: MSG.PLAYER_LEFT, slot: p.slot, reason });
    this.serverMessage(`"${p.nickname}" left the match`);
    if (this.phase === PHASE.LOADING && this.activePlayers.length > 0 && this.activePlayers.every((q) => q.ready)) {
      this.clearTimer();
      if (!this.checkMatchOver()) this.startRound(1);
      return;
    }
    if (this.phase === PHASE.RACING) this.maybeShortenRound();
  }

  pingsMessage() {
    const pings = {};
    for (const p of this.players) {
      if (p.connected) pings[p.slot] = this.io.getPing?.(p.id) ?? null;
    }
    return { type: MSG.PINGS, pings };
  }

  destroy() {
    this.clearTimer();
    for (const t of this._graceTimers.values()) this.clock.clearTimeout(t);
    this._graceTimers.clear();
  }
}
