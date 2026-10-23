import { MSG, decodeCarBatch, relayFromBatch } from "../../shared/protocol.js";
import { liveOrder, finishPlaces, cupOrder, cupPlaces } from "../../shared/cupstandings.js";
import { publicTrack, pickTrack } from "./tracks.js";
import { defaultClock } from "./match.js";
import { resolveCupRules } from "./config.js";
import { createWorldRecords } from "./worldrecords.js";

/** What clients see of a stored cup record. */
export function publicCupRecord(record) {
  if (!record || !Number.isSafeInteger(record.frames)) return null;
  return { frames: record.frames, nickname: record.nickname ?? "?", nicknames: [record.nickname ?? "?"], playerId: record.playerId ?? null, countryCode: record.countryCode ?? null, setAt: record.setAt ?? null, cupNumber: record.cupNumber ?? null };
}

function memoryRecordStore() {
  const map = new Map();
  return { get: (id) => map.get(id) ?? null, set: (id, rec) => map.set(id, rec), all: () => Object.fromEntries(map) };
}

export const CUP_PHASE = Object.freeze({
  IDLE: "idle", // waiting for enough racers
  BREAK: "break", // the next round starts shortly
  LOADING: "loading", // round announced; racers load the track
  WARMUP: "warmup", // free practice on a new track
  COUNTDOWN: "countdown", // 3, 2, 1
  RACING: "racing", // the live round
  COMPLETE: "complete", // someone won; the next cup starts after the break
});

const ROUND_PHASES = new Set([CUP_PHASE.LOADING, CUP_PHASE.WARMUP, CUP_PHASE.COUNTDOWN, CUP_PHASE.RACING]);
const GAME_MODE = { CASUAL: 0, COMPETITIVE: 1 };

/**
 * The always-on cup, run like a PolyCup lobby that never closes: players join and leave whenever
 * they like (late joiners spectate until the next round), every `roundsPerTrack` rounds a new random
 * track is drawn with a warmup on its first visit (length from the world record), rounds are live
 * (everyone starts at GO, one run with checkpoint respawns, retire = DNF, the others get
 * `finishTimeoutSeconds` once somebody finishes), places score points, the first racer at the target
 * with a unique lead wins and after a break the standings reset and the next cup starts by itself.
 *
 * Like `Match` it never touches sockets: `io.send`, `io.sendBinary`, `io.getPing`,
 * `io.onPlayerRemoved(cup, playerId)` and `io.onCupFinished(cup, summary)` are injected.
 */
export class Cup {
  /**
   * @param {object} args
   * @param {string} [args.id]
   * @param {object} args.cfg full server config (uses cfg.cup)
   * @param {object[]} args.pool track pool (entries carry `category`)
   * @param {object} args.io
   * @param {object} [args.clock]
   * @param {object} [args.log]
   * @param {() => number} [args.rng]
   * @param {object} [args.worldRecords] createWorldRecords() instance (tests inject a fake)
   * @param {{get(trackId:string): object|null, set(trackId:string, record:object): void}} [args.recordStore]
   *   permanent cup track records (the server's player registry); in memory when omitted
   */
  constructor({ id = "cup", cfg, pool, io, clock = defaultClock, log = console, rng = Math.random, worldRecords = null, recordStore = null }) {
    this.id = id;
    this.cfg = cfg;
    this.settings = cfg.cup;
    this.rules = resolveCupRules(cfg.cup);
    this.pool = pool;
    this.io = io;
    this.clock = clock;
    this.log = log;
    this.rng = rng;
    this.queueId = "cup";
    const wrCfg = cfg.cup.worldRecords ?? {};
    this.worldRecords = worldRecords ?? createWorldRecords({ ...wrCfg, enabled: wrCfg.enabled !== false, now: () => clock.now(), log });
    this.recordStore = recordStore ?? memoryRecordStore();
    this.phase = CUP_PHASE.IDLE;
    /** @type {Map<string, object>} playerId -> member */
    this.members = new Map();
    /** Points of the current cup by player id, so a returning racer continues where they left. */
    this.scores = new Map();
    this.cupNumber = 0;
    this.cupsCompleted = 0;
    this.round = 0; // rounds played (or running) in the current cup
    this.trackRounds = 0; // rounds on the current track
    this.track = null;
    this.usedTrackIds = []; // tracks visited in this cup (warmup on the first visit only)
    this.recentTrackIds = [];
    this._peekedTrack = null;
    /** @type {Map<string, {wr: object|null, tr: object|null}>} wr: world record, tr: the server's cup record for the track (permanent, with its holder) */
    this.trackRecords = new Map();
    this.run = null; // the running round, see startRound()
    this.lastRound = null;
    this.lastTrack = null; // the track of the last round (shown while the next one is prepared)
    this.winner = null;
    this.lastWinner = null;
    this.nextAt = 0;
    this.roundHistory = [];
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

  get inRound() {
    return ROUND_PHASES.has(this.phase);
  }

  get sessionId() {
    return this.run?.sessionId ?? 0;
  }

  get gameMode() {
    return this.rules.uploadLeaderboardTimes ? GAME_MODE.CASUAL : GAME_MODE.COMPETITIVE;
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

  bySlot(slot) {
    for (const p of this.members.values()) if (p.slot === slot) return p;
    return null;
  }

  pointsBySlot() {
    const points = {};
    for (const p of this.members.values()) points[p.slot] = this.pointsOf(p);
    return points;
  }

  racing(p) {
    return !!this.run && this.run.racers.has(p.slot);
  }

  roundDone(slot) {
    return !!this.run && (this.run.finishes.has(slot) || this.run.dnfs.has(slot));
  }

  records(trackId) {
    let r = this.trackRecords.get(trackId);
    if (!r) {
      r = { wr: null, tr: publicCupRecord(this.recordStore.get(trackId)) };
      this.trackRecords.set(trackId, r);
    }
    return r;
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
      loaded: p.loaded,
      racing: this.racing(p),
      pending: this.inRound && !this.racing(p),
      points: this.pointsOf(p),
      pb: p.pb && this.track && p.pb.trackId === this.track.id ? p.pb.frames : undefined,
    };
  }

  publicRules() {
    const r = this.rules;
    return {
      target: r.pointsToWin,
      points: r.points,
      roundsPerTrack: r.roundsPerTrack,
      finishTimeoutSeconds: r.finishTimeoutSeconds,
      roundBreakSeconds: r.roundBreakSeconds,
      warmup: r.warmup,
      warmupTiming: r.warmupTiming,
      readyEndsWarmup: r.readyEndsWarmup,
      allowSpectatorFreecam: r.allowSpectatorFreecam,
      allowRacerChanges: r.allowRacerChanges,
      uploadLeaderboardTimes: r.uploadLeaderboardTimes,
      pool: r.pool,
    };
  }

  format() {
    return {
      scoring: "points",
      teams: null,
      teamSize: null,
      roundsToWin: null,
      maxRounds: null,
      pointsTable: this.rules.points,
      trackPerRound: false,
      cup: true,
      live: true,
      target: this.rules.pointsToWin,
      roundsPerTrack: this.rules.roundsPerTrack,
      gameMode: this.gameMode,
    };
  }

  scoresInfo() {
    return { roundsPlayed: this.lastRound ? this.lastRound.round : Math.max(0, this.round - (this.run ? 1 : 0)), roundWins: null, points: this.pointsBySlot() };
  }

  standings() {
    const places = cupPlaces(this.players.map((p) => ({ slot: p.slot, points: this.pointsOf(p) })));
    return this.players
      .map((p) => ({ slot: p.slot, id: p.id, nickname: p.nickname, countryCode: p.countryCode, points: this.pointsOf(p), place: places.get(p.slot) ?? null, connected: p.connected }))
      .sort((a, b) => b.points - a.points || a.slot - b.slot);
  }

  publicTrackInfo(track) {
    if (!track) return null;
    const rec = this.records(track.id);
    return { ...publicTrack(track), wr: rec.wr ?? this.worldRecords.peek(track.id) ?? null, tr: rec.tr };
  }

  liveState() {
    const run = this.run;
    if (!run) return null;
    const finishes = {};
    for (const [slot, f] of run.finishes) finishes[slot] = f;
    const splits = {};
    for (const [slot, s] of run.splits) splits[slot] = { index: s.index, frames: s.frames, bestFrames: run.bestSplits.get(s.index) ?? s.frames };
    const movement = {};
    for (const [slot, m] of run.movement) movement[slot] = m;
    return {
      sessionId: run.sessionId,
      round: run.round,
      trackId: run.trackId,
      racers: [...run.racers],
      ready: [...run.ready],
      warmup: run.warmup,
      warmupMs: run.warmupMs,
      warmupReady: [...run.warmupReady],
      warmupEndsAt: run.warmupEndsAt,
      startsAt: run.startsAt,
      deadline: run.deadline,
      limitAt: run.limitAt,
      finishes,
      dnfs: [...run.dnfs],
      splits,
      movement,
    };
  }

  /** Everything a client (or /api/cup) needs to describe the lobby. */
  publicState() {
    return {
      enabled: true,
      id: this.id,
      name: this.settings.name,
      phase: this.phase,
      cupNumber: this.cupNumber,
      cupsCompleted: this.cupsCompleted,
      round: this.round,
      trackRounds: this.trackRounds,
      roundsPerTrack: this.rules.roundsPerTrack,
      target: this.rules.pointsToWin,
      pointsTable: this.rules.points,
      rules: this.publicRules(),
      minPlayers: this.settings.minPlayers,
      maxPlayers: this.settings.maxPlayers,
      gameMode: this.gameMode,
      track: this.publicTrackInfo(this.inRound ? this.track : this.upcomingTrack()),
      lastTrack: this.lastTrack && !this.inRound ? this.publicTrackInfo(this.lastTrack) : null,
      players: this.players.map((p) => this.publicPlayer(p)),
      standings: this.standings(),
      live: this.liveState(),
      lastRound: this.lastRound,
      winner: this.winner,
      nextAt: this.phase === CUP_PHASE.BREAK || this.phase === CUP_PHASE.COMPLETE ? this.nextAt : null,
      lastWinner: this.lastWinner,
      serverTime: this.clock.now(),
    };
  }

  baseInfo() {
    return {
      matchId: this.id,
      queueId: this.queueId,
      queueName: this.settings.name,
      format: this.format(),
      players: this.players.map((p) => this.publicPlayer(p)),
      track: this.publicTrackInfo(this.inRound ? this.track : this.upcomingTrack()),
      countdownSeconds: this.settings.countdownSeconds,
      readyTimeoutSeconds: this.settings.loadGraceSeconds,
      cup: this.publicState(),
    };
  }

  /** Full picture for a (re)joining client: the running round, if any, is included so it can spectate. */
  snapshot() {
    const run = this.run;
    return {
      ...this.baseInfo(),
      phase: this.phase,
      round: run ? run.round : 0,
      sessionId: run ? run.sessionId : 0,
      startsAt: run?.startsAt ?? 0,
      endsAt: run?.deadline ?? run?.limitAt ?? 0,
      scores: this.scoresInfo(),
      records: run ? Object.fromEntries(run.finishes) : {},
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

  // ---------------------------------------------------------------- tracks & records

  /** The track the next round is raced on (drawn ahead of time so clients can preload it). */
  upcomingTrack() {
    if (this.track && (this.inRound || this.trackRounds < this.rules.roundsPerTrack)) return this.track;
    if (!this._peekedTrack) {
      const avoid = [...new Set([...this.usedTrackIds, ...this.recentTrackIds])];
      this._peekedTrack = pickTrack(this.pool, Infinity, avoid, this.rng);
      if (!this._peekedTrack) throw new Error("the cup has no tracks");
      this.requestWorldRecord(this._peekedTrack);
    }
    return this._peekedTrack;
  }

  /** Make the upcoming track the current one (new track block). */
  pickNextTrack() {
    this.track = this.upcomingTrack();
    this._peekedTrack = null;
    this.trackRounds = 0;
    this.recentTrackIds.push(this.track.id);
    if (this.recentTrackIds.length > 6) this.recentTrackIds.shift();
    return this.track;
  }

  requestWorldRecord(track) {
    const rec = this.records(track.id);
    const verified = track.category === "official" || track.category === "community";
    const result = this.worldRecords.lookup(track.id, {
      verified,
      onReady: (wr) => {
        this.records(track.id).wr = wr;
        if (this.members.size && (this.track?.id === track.id || this._peekedTrack?.id === track.id)) this.broadcastState();
      },
    });
    if (result) rec.wr = result;
    return rec.wr;
  }

  /** Warmup length for a track (PolyCup: WR x multiplier, at least the minimum; a fixed time without a WR). */
  warmupMsFor(trackId) {
    const r = this.rules;
    if (r.warmup === "off") return 0;
    if (r.warmupTiming === "fixed") return r.warmupSeconds * 1000;
    const wr = this.records(trackId).wr;
    const frames = wr?.status === "ready" && Number.isSafeInteger(wr.frames) && wr.frames > 0 && wr.frames <= 3_600_000 ? wr.frames : null;
    return frames == null ? r.warmupSeconds * 1000 : Math.max(r.warmupMinimumSeconds * 1000, Math.ceil(frames * r.warmupMultiplier));
  }

  /** Safety limit of a live round (0 = none). */
  roundLimitMsFor(trackId) {
    const l = this.settings.roundLimit;
    if (!l || l.enabled === false) return 0;
    const wr = this.records(trackId).wr;
    const frames = wr?.status === "ready" && Number.isSafeInteger(wr.frames) && wr.frames > 0 ? wr.frames : null;
    return frames == null ? (l.withoutWrSeconds ?? 300) * 1000 : Math.max((l.minimumSeconds ?? 120) * 1000, Math.ceil(frames * (l.multiplier ?? 4)));
  }

  /** The track's cup record is permanent: a faster finish replaces it (ties keep the first holder). */
  updateTrackRecord(trackId, finishes) {
    const rec = this.records(trackId);
    const stored = this.recordStore.get(trackId);
    let best = stored && Number.isSafeInteger(stored.frames) ? stored : null;
    for (const [slot, frames] of finishes) {
      if (best && frames >= best.frames) continue;
      const p = this.bySlot(slot);
      best = { frames, playerId: p?.id ?? null, nickname: p?.nickname ?? "?", countryCode: p?.countryCode ?? null, setAt: this.clock.now(), cupNumber: this.cupNumber, round: this.round };
    }
    if (best && best !== stored) {
      this.recordStore.set(trackId, best);
      this.log.info?.(`[cup] new cup record on ${trackId.slice(0, 8)}: ${best.nickname} ${best.frames} ms`);
    }
    rec.tr = publicCupRecord(best);
  }

  // ---------------------------------------------------------------- membership

  /**
   * @param {{id:string, nickname:string, countryCode:string|null, carStyle:string|null}} info
   * @returns {{ok: true} | {ok: false, code: string, message: string}}
   */
  join(info) {
    const existing = this.members.get(info.id);
    if (existing) {
      existing.connected = true;
      this.send(existing, { type: MSG.MATCH_FOUND, ...this.snapshot(), you: existing.slot });
      return { ok: true };
    }
    if (this.members.size >= this.settings.maxPlayers) return { ok: false, code: "cup_full", message: `The cup is full (${this.settings.maxPlayers} racers)` };
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
      pb: null,
    };
    this.members.set(p.id, p);
    if (!this.scores.has(p.id)) this.scores.set(p.id, 0);
    this.send(p, { type: MSG.MATCH_FOUND, ...this.snapshot(), you: slot });
    this.serverMessage(`"${p.nickname}" joined the cup${this.pointsOf(p) ? ` (${this.pointsOf(p)} pts)` : ""}`);
    this.broadcastState();
    return { ok: true };
  }

  /** The player is in and has loaded the track (match_ready): eligible for rounds. */
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
    if (this.phase === CUP_PHASE.BREAK && this.eligiblePlayers.length < this.settings.minPlayers) {
      this.clearTimer();
      this.phase = CUP_PHASE.IDLE;
      this.nextAt = 0;
    }
    if (!this.checkRoundProgress()) this.checkRoundGates();
    this.broadcastState();
    const t = this.clock.setTimeout(() => {
      this._graceTimers.delete(p.id);
      if (!p.connected && this.members.get(p.id) === p) this.removePlayer(p, "disconnected");
    }, this.settings.disconnectGraceSeconds * 1000);
    this._graceTimers.set(p.id, t);
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
    const wasRacing = this.racing(p) && !this.roundDone(p.slot);
    this.members.delete(p.id);
    const t = this._graceTimers.get(p.id);
    if (t) {
      this.clock.clearTimeout(t);
      this._graceTimers.delete(p.id);
    }
    if (this.run) {
      if (wasRacing && this.phase === CUP_PHASE.RACING) this.run.dnfs.add(p.slot);
      else if (wasRacing) this.run.racers.delete(p.slot);
      this.run.ready.delete(p.slot);
      this.run.warmupReady.delete(p.slot);
    }
    this.broadcast({ type: MSG.PLAYER_LEFT, slot: p.slot, reason });
    this.serverMessage(`"${p.nickname}" left the cup`);
    this.io.onPlayerRemoved?.(this, p.id);
    if (this.members.size === 0) {
      this.onEmpty();
      return;
    }
    if (this.phase === CUP_PHASE.BREAK && this.eligiblePlayers.length < this.settings.minPlayers) {
      this.clearTimer();
      this.phase = CUP_PHASE.IDLE;
      this.nextAt = 0;
    }
    if (!this.checkRoundProgress()) this.checkRoundGates();
    this.broadcastState();
  }

  /** A racer dropped out before GO: the ones left may already be waiting on nobody. */
  checkRoundGates() {
    const run = this.run;
    if (!run) return;
    const racers = [...run.racers].filter((slot) => this.bySlot(slot)?.connected);
    if (this.phase === CUP_PHASE.LOADING || this.phase === CUP_PHASE.WARMUP || this.phase === CUP_PHASE.COUNTDOWN) {
      if (run.racers.size === 0) {
        this.voidRound();
        return;
      }
    }
    if (this.phase === CUP_PHASE.LOADING && racers.length && racers.every((slot) => run.ready.has(slot))) this.beginWarmupOrCountdown();
    else if (this.phase === CUP_PHASE.WARMUP && this.rules.readyEndsWarmup && racers.length && racers.every((slot) => run.warmupReady.has(slot))) this.beginCountdown();
  }

  onEmpty() {
    this.clearTimer();
    this.run = null;
    const wasBusy = this.phase !== CUP_PHASE.IDLE;
    this.phase = CUP_PHASE.IDLE;
    this.nextAt = 0;
    if (wasBusy) this.log.info?.(`[cup] everyone left during cup ${this.cupNumber}; standings kept for ${this.settings.idleResetSeconds}s`);
    if (this._idleTimer) this.clock.clearTimeout(this._idleTimer);
    this._idleTimer = this.clock.setTimeout(() => {
      this._idleTimer = null;
      if (this.members.size === 0) this.resetCup();
    }, this.settings.idleResetSeconds * 1000);
  }

  broadcastState() {
    this.broadcast({ type: MSG.CUP_STATE, cup: this.publicState() });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Enough loaded racers and nothing running: schedule the next round. */
  maybeStart() {
    if (this.phase !== CUP_PHASE.IDLE) return;
    if (this.eligiblePlayers.length < this.settings.minPlayers) return;
    this.phase = CUP_PHASE.BREAK;
    const wait = this.rules.roundBreakSeconds * 1000;
    this.nextAt = this.clock.now() + wait;
    if (this.round === 0) {
      this.cupNumber += 1;
      this.serverMessage(`Cup #${this.cupNumber} starts in ${this.rules.roundBreakSeconds} s – first to ${this.rules.pointsToWin} points wins`);
    } else {
      this.serverMessage(`The cup continues in ${this.rules.roundBreakSeconds} s`);
    }
    this.setTimer(() => this.startRound(), wait);
  }

  startRound() {
    if (this.eligiblePlayers.length < this.settings.minPlayers) {
      this.phase = CUP_PHASE.IDLE;
      this.nextAt = 0;
      this.run = null;
      this.serverMessage("Waiting for more racers…");
      this.broadcastState();
      return;
    }
    if (!this.track || this.trackRounds >= this.rules.roundsPerTrack) this.pickNextTrack();
    const firstVisit = !this.usedTrackIds.includes(this.track.id);
    if (firstVisit) this.usedTrackIds.push(this.track.id);
    this.round += 1;
    this.trackRounds += 1;
    const warmup = this.rules.warmup !== "off" && this.trackRounds === 1 && (this.rules.warmup === "every-visit" || firstVisit);
    const racers = this.eligiblePlayers.map((p) => p.slot);
    for (const p of this.members.values()) p.resetCounter = 0;
    this.run = {
      sessionId: this.makeSessionId(this.round),
      round: this.round,
      trackId: this.track.id,
      racers: new Set(racers),
      ready: new Set(),
      warmup,
      warmupMs: warmup ? this.warmupMsFor(this.track.id) : 0,
      warmupReady: new Set(),
      warmupEndsAt: null,
      startsAt: null,
      deadline: null,
      limitAt: null,
      finishes: new Map(),
      dnfs: new Set(),
      splits: new Map(),
      bestSplits: new Map(),
      movement: new Map(),
      beforeRanking: cupOrder({ players: this.players.map((p) => ({ slot: p.slot, points: this.pointsOf(p) })) }),
    };
    this.phase = CUP_PHASE.LOADING;
    this.nextAt = 0;
    this.winner = null;
    this.broadcast({
      type: MSG.ROUND_START,
      round: this.round,
      sessionId: this.run.sessionId,
      track: this.publicTrackInfo(this.track),
      trackRound: this.trackRounds,
      roundsPerTrack: this.rules.roundsPerTrack,
      warmup,
      warmupMs: this.run.warmupMs,
      gameMode: this.gameMode,
      racers,
      loadGraceMs: this.settings.loadGraceSeconds * 1000,
      countdownSeconds: this.settings.countdownSeconds,
      startsAt: null,
      endsAt: null,
      scores: this.scoresInfo(),
      players: this.players.map((p) => this.publicPlayer(p)),
      cup: this.publicState(),
    });
    this.setTimer(() => this.onLoadGraceExpired(), this.settings.loadGraceSeconds * 1000);
  }

  /** A racer's game created the in-game state for this round's session. */
  roundReady(playerId, sessionId, pb) {
    const p = this.members.get(playerId);
    const run = this.run;
    if (!p || !run || sessionId !== run.sessionId) return;
    if (pb !== undefined) p.pb = { trackId: run.trackId, frames: Number.isSafeInteger(pb) && pb > 0 ? pb : null };
    if (!run.racers.has(p.slot) || run.ready.has(p.slot)) {
      this.broadcastState();
      return;
    }
    run.ready.add(p.slot);
    if (this.phase === CUP_PHASE.LOADING && [...run.racers].every((s) => run.ready.has(s) || !this.bySlot(s)?.connected)) this.beginWarmupOrCountdown();
    else this.broadcastState();
  }

  onLoadGraceExpired() {
    const run = this.run;
    if (!run || this.phase !== CUP_PHASE.LOADING) return;
    for (const slot of [...run.racers]) if (!run.ready.has(slot)) run.racers.delete(slot); // sits this round out
    if (run.racers.size === 0) {
      this.log.info?.("[cup] nobody loaded the track; round voided");
      this.voidRound();
      return;
    }
    this.beginWarmupOrCountdown();
  }

  beginWarmupOrCountdown() {
    const run = this.run;
    if (run.warmup && run.warmupMs > 0) {
      this.phase = CUP_PHASE.WARMUP;
      run.warmupEndsAt = this.clock.now() + run.warmupMs;
      this.setTimer(() => this.beginCountdown(), run.warmupMs);
      this.broadcastState();
    } else this.beginCountdown();
  }

  /** "Ready" during the warmup: once every racer is done practising the countdown starts. */
  warmupReady(playerId, sessionId) {
    const p = this.members.get(playerId);
    const run = this.run;
    if (!p || !run || this.phase !== CUP_PHASE.WARMUP || sessionId !== run.sessionId || !run.racers.has(p.slot)) return;
    if (run.warmupReady.has(p.slot)) return;
    run.warmupReady.add(p.slot);
    if (this.rules.readyEndsWarmup && [...run.racers].every((s) => run.warmupReady.has(s) || !this.bySlot(s)?.connected)) this.beginCountdown();
    else this.broadcastState();
  }

  beginCountdown() {
    const run = this.run;
    if (!run || this.phase === CUP_PHASE.COUNTDOWN || this.phase === CUP_PHASE.RACING) return;
    this.phase = CUP_PHASE.COUNTDOWN;
    run.startsAt = this.clock.now() + this.settings.countdownSeconds * 1000;
    this.setTimer(() => this.onRaceStart(), run.startsAt - this.clock.now());
    this.broadcastState();
  }

  onRaceStart() {
    const run = this.run;
    if (!run || this.phase !== CUP_PHASE.COUNTDOWN) return;
    this.phase = CUP_PHASE.RACING;
    const limit = this.roundLimitMsFor(run.trackId);
    run.limitAt = limit > 0 ? run.startsAt + limit : null;
    this.scheduleRoundEnd();
    this.broadcastState();
  }

  scheduleRoundEnd() {
    const run = this.run;
    const at = Math.min(run.deadline ?? Infinity, run.limitAt ?? Infinity);
    if (!Number.isFinite(at)) {
      this.clearTimer();
      return;
    }
    this.setTimer(() => this.endRound(), at + this.settings.lateFinishGraceMs - this.clock.now());
  }

  /** Live ranking movement since the previous update (▲/▼ in the HUD). */
  trackMovement(fn) {
    const run = this.run;
    const racers = [...run.racers];
    const before = liveOrder(this.liveState(), racers);
    fn();
    const after = liveOrder(this.liveState(), racers);
    for (const slot of racers) run.movement.set(slot, before.indexOf(slot) - after.indexOf(slot));
  }

  /** A finish of the live round (from the car hook or the game's own record report). */
  finish(playerId, sessionId, frames) {
    const p = this.members.get(playerId);
    const run = this.run;
    if (!p || !run || sessionId !== run.sessionId || !run.racers.has(p.slot) || this.roundDone(p.slot)) return false;
    if (this.phase !== CUP_PHASE.RACING || run.startsAt == null) return false;
    if (!Number.isSafeInteger(frames) || frames <= 0 || frames > 3_600_000) return false;
    const now = this.clock.now();
    if (frames > now - run.startsAt + 2500) return false; // from a run that started before GO
    if (run.deadline != null && (now > run.deadline + this.settings.lateFinishGraceMs || frames > run.deadline - run.startsAt)) return false;
    this.trackMovement(() => run.finishes.set(p.slot, frames));
    run.deadline = Math.min(run.deadline ?? Infinity, run.startsAt + frames + this.rules.finishTimeoutSeconds * 1000);
    const records = Object.fromEntries(run.finishes);
    this.broadcast({ type: MSG.RECORDS, sessionId: run.sessionId, records });
    if (!this.checkRoundProgress()) {
      this.scheduleRoundEnd();
      this.broadcastState();
    }
    return true;
  }

  /** The game's record report; during a live round it counts as the finish. */
  record(playerId, sessionId, frames) {
    this.finish(playerId, sessionId, frames);
  }

  checkpoint(playerId, sessionId, index, frames) {
    const p = this.members.get(playerId);
    const run = this.run;
    if (!p || !run || this.phase !== CUP_PHASE.RACING || sessionId !== run.sessionId || !run.racers.has(p.slot) || this.roundDone(p.slot)) return false;
    if (!Number.isSafeInteger(index) || index < 0 || index > 1000 || !Number.isSafeInteger(frames) || frames <= 0 || frames > 3_600_000) return false;
    const now = this.clock.now();
    if (frames > now - run.startsAt + 2500) return false;
    const previous = run.splits.get(p.slot);
    if (previous && (index <= previous.index || frames < previous.frames)) return false;
    this.trackMovement(() => {
      run.splits.set(p.slot, { index, frames });
      run.bestSplits.set(index, Math.min(run.bestSplits.get(index) ?? Infinity, frames));
    });
    this.broadcastState();
    return true;
  }

  /** Retire from the live round. */
  dnf(playerId, sessionId) {
    const p = this.members.get(playerId);
    const run = this.run;
    if (!p || !run || this.phase !== CUP_PHASE.RACING || sessionId !== run.sessionId || !run.racers.has(p.slot) || this.roundDone(p.slot)) return false;
    this.trackMovement(() => run.dnfs.add(p.slot));
    if (!this.checkRoundProgress()) this.broadcastState();
    return true;
  }

  /** End the round once every racer still connected has finished or retired. @returns {boolean} ended */
  checkRoundProgress() {
    const run = this.run;
    if (!run || this.phase !== CUP_PHASE.RACING) return false;
    const open = [...run.racers].filter((slot) => !this.roundDone(slot) && this.bySlot(slot)?.connected);
    if (open.length) return false;
    this.endRound();
    return true;
  }

  voidRound() {
    this.run = null;
    this.phase = CUP_PHASE.BREAK;
    this.nextAt = this.clock.now() + this.rules.roundBreakSeconds * 1000;
    this.setTimer(() => this.startRound(), this.rules.roundBreakSeconds * 1000);
    this.broadcastState();
  }

  endRound() {
    const run = this.run;
    if (!run || this.phase !== CUP_PHASE.RACING) return;
    this.clearTimer();
    const racers = [...run.racers];
    for (const slot of racers) if (!run.finishes.has(slot)) run.dnfs.add(slot);
    const finishes = Object.fromEntries(run.finishes);
    const places = finishPlaces(finishes);
    const points = {};
    for (const slot of racers) points[slot] = places[slot] ? this.rules.points[places[slot] - 1] ?? 0 : 0;
    for (const slot of racers) {
      const p = this.bySlot(slot);
      if (p) this.scores.set(p.id, this.pointsOf(p) + points[slot]);
    }
    this.updateTrackRecord(run.trackId, run.finishes);
    const ranking = cupOrder({ players: this.players.map((p) => ({ slot: p.slot, points: this.pointsOf(p) })) });
    const movement = {};
    for (const slot of ranking) {
      const before = run.beforeRanking.indexOf(slot);
      movement[slot] = before < 0 ? 0 : before - ranking.indexOf(slot);
    }
    const results = racers
      .map((slot) => ({ slot, frames: finishes[slot] ?? null, position: places[slot] ?? null, points: points[slot] }))
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.slot - b.slot);
    const first = results[0];
    const roundWinner = first?.position === 1 && results.filter((r) => r.position === 1).length === 1 ? { type: "player", slot: first.slot } : null;
    this.lastRound = { cup: this.cupNumber, round: run.round, trackId: run.trackId, finishes, points, dnfs: [...run.dnfs], movement, winnerSlot: roundWinner?.slot ?? null, results };
    this.lastTrack = this.track;
    this.roundHistory.push({ cup: this.cupNumber, round: run.round, trackId: run.trackId, results, roundWinner });
    if (this.roundHistory.length > 100) this.roundHistory.shift();
    this.run = null;

    const winner = this.findWinner();
    const enough = this.eligiblePlayers.length >= this.settings.minPlayers;
    const nextRoundIn = winner || !enough ? null : this.rules.roundBreakSeconds * 1000;
    const switching = this.trackRounds >= this.rules.roundsPerTrack;
    this.phase = winner ? CUP_PHASE.COMPLETE : enough ? CUP_PHASE.BREAK : CUP_PHASE.IDLE;
    const nextTrack = !winner && switching ? this.publicTrackInfo(this.upcomingTrack()) : null;
    this.nextAt = winner ? this.clock.now() + this.settings.breakSeconds * 1000 : enough ? this.clock.now() + nextRoundIn : 0;
    this.broadcast({
      type: MSG.ROUND_END,
      round: this.lastRound.round,
      sessionId: this.makeSessionId(this.lastRound.round),
      results,
      roundWinner,
      teamPoints: null,
      scores: this.scoresInfo(),
      nextRoundIn,
      nextTrack,
      matchOver: false,
      cupOver: !!winner,
      cup: this.publicState(),
    });
    if (winner) this.completeCup(winner);
    else if (enough) this.setTimer(() => this.startRound(), nextRoundIn);
    else this.serverMessage("Waiting for more racers…");
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
    if (best >= this.rules.pointsToWin && leaders.length === 1) return leaders[0];
    return null;
  }

  completeCup(winner) {
    this.phase = CUP_PHASE.COMPLETE;
    this.cupsCompleted += 1;
    const standings = this.standings();
    this.winner = { slot: winner.slot, id: winner.id, nickname: winner.nickname, points: this.pointsOf(winner) };
    this.lastWinner = { ...this.winner, cupNumber: this.cupNumber, rounds: this.round, finishedAt: this.clock.now() };
    this.log.info?.(`[cup] cup #${this.cupNumber} won by ${winner.nickname} with ${this.pointsOf(winner)} points after ${this.round} rounds`);
    this.io.onCupFinished?.(this, { cupNumber: this.cupNumber, winner: this.lastWinner, standings, rounds: this.round, trackIds: this.usedTrackIds.slice(), finishedAt: this.clock.now() });
    // The next cup starts on a fresh track; announce it now so clients can preload it.
    this.trackRounds = this.rules.roundsPerTrack;
    this.broadcast({
      type: MSG.CUP_END,
      cupNumber: this.cupNumber,
      winner: { type: "player", ...this.winner },
      standings,
      scores: this.scoresInfo(),
      rounds: this.round,
      nextCupIn: this.settings.breakSeconds * 1000,
      nextAt: this.nextAt,
      nextTrack: this.publicTrackInfo(this.upcomingTrack()),
      players: this.players.map((p) => this.publicPlayer(p)),
      cup: this.publicState(),
    });
    this.setTimer(() => this.nextCup(), this.settings.breakSeconds * 1000);
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
    this.usedTrackIds = [];
    this.run = null;
    this.lastRound = null;
    this.lastTrack = null;
    this.winner = null;
    this.phase = CUP_PHASE.IDLE;
    this.nextAt = 0;
  }

  // ---------------------------------------------------------------- car relay

  carBatch(playerId, bytes) {
    const p = this.members.get(playerId);
    if (!p || !this.run || !this.racing(p)) return;
    let header;
    try {
      header = decodeCarBatch(bytes);
    } catch {
      return;
    }
    if (header.sessionId !== this.run.sessionId) return;
    if (header.resetCounter > p.resetCounter) p.resetCounter = header.resetCounter;
    const relay = relayFromBatch(p.slot, bytes);
    for (const q of this.members.values()) {
      if (q !== p && q.connected) this.io.sendBinary(q.id, relay);
    }
  }

  carReset(playerId, sessionId, resetCounter) {
    const p = this.members.get(playerId);
    if (!p || !this.run || !this.racing(p) || sessionId !== this.run.sessionId) return;
    if (!Number.isInteger(resetCounter) || resetCounter < 0) return;
    if (resetCounter > p.resetCounter) p.resetCounter = resetCounter;
    for (const q of this.members.values()) {
      if (q !== p) this.send(q, { type: MSG.CAR_RESET, sessionId, slot: p.slot, resetCounter });
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
