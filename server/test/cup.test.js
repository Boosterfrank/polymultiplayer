import { test } from "node:test";
import assert from "node:assert/strict";
import { Cup, CUP_PHASE } from "../src/cup.js";
import { MSG, encodeCarBatch, decodeCarRelay } from "../../shared/protocol.js";
import { buildPool } from "../src/tracks.js";
import { standings } from "../../shared/cupstandings.js";
import { FakeClock, FakeIO, testConfig } from "./helpers.js";

class CupIO extends FakeIO {
  constructor() {
    super();
    this.removed = [];
    this.cups = [];
  }
  onPlayerRemoved(cup, playerId) {
    this.removed.push(playerId);
  }
  onCupFinished(cup, summary) {
    this.cups.push(summary);
  }
}

const TRACK_A = "a".repeat(64);
const TRACK_B = "b".repeat(64);

/** World records the fake leaderboard answers with (frames), by track id. */
function fakeWorldRecords(records = {}) {
  const known = new Map(Object.entries(records).map(([id, frames]) => [id, { status: "ready", frames, nickname: "wrholder", countryCode: "se" }]));
  return {
    lookups: [],
    lookup(trackId, { onReady } = {}) {
      this.lookups.push(trackId);
      const rec = known.get(trackId) ?? { status: "missing" };
      onReady?.(rec);
      return rec;
    },
    peek(trackId) {
      return known.get(trackId) ?? null;
    },
  };
}

const RULES = { roundsPerTrack: 2, pointsToWin: 20, points: [10, 8, 6], warmup: "first-visit", warmupTiming: "wr", warmupSeconds: 90, warmupMultiplier: 1.4, warmupMinimumSeconds: 30, readyEndsWarmup: true, finishTimeoutSeconds: 10, roundBreakSeconds: 5 };

function makeCup({ rules = {}, cup = {}, worldRecords = fakeWorldRecords({ [TRACK_A]: 60000 }), ...overrides } = {}) {
  const cfg = testConfig({
    cup: { enabled: true, name: "Test Cup", minPlayers: 2, maxPlayers: 3, rules: { ...RULES, ...rules }, countdownSeconds: 3, loadGraceSeconds: 20, disconnectGraceSeconds: 15, lateFinishGraceMs: 1000, roundLimit: { enabled: true, multiplier: 4, minimumSeconds: 120, withoutWrSeconds: 300 }, breakSeconds: 10, idleResetSeconds: 60, ...cup },
    ...overrides,
  });
  const clock = new FakeClock();
  const io = new CupIO();
  // deterministic track draws: always the first candidate
  const c = new Cup({ cfg, pool: buildPool(cfg.tracks), io, clock, log: { info() {}, warn() {}, error() {} }, rng: () => 0, worldRecords });
  return { cfg, clock, io, cup: c, worldRecords };
}

const player = (n) => ({ id: `p${n}`, nickname: `Player ${n}`, countryCode: null, carStyle: null });

function joinAndLoad(cup, n) {
  assert.equal(cup.join(player(n)).ok, true);
  cup.ready(`p${n}`);
}

/** Round announced -> every racer loaded -> warmup (if any) -> everyone ready -> GO. */
function reachRacing(cup, clock, ids = ["p1", "p2"]) {
  assert.equal(cup.phase, CUP_PHASE.LOADING);
  for (const id of ids) cup.roundReady(id, cup.sessionId);
  if (cup.phase === CUP_PHASE.WARMUP) for (const id of ids) cup.warmupReady(id, cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
  clock.advance(3000);
  assert.equal(cup.phase, CUP_PHASE.RACING);
}

test("lobby: two loaded racers start a round after the break; the first visit of a track has a warmup sized by the WR", () => {
  const { cup, io, clock, worldRecords } = makeCup();
  assert.equal(cup.phase, CUP_PHASE.IDLE);
  assert.equal(cup.join(player(1)).ok, true);
  const found = io.last("p1", MSG.MATCH_FOUND);
  assert.equal(found.you, 1);
  assert.equal(found.format.cup, true);
  assert.equal(found.format.live, true);
  assert.equal(found.format.gameMode, 0, "leaderboard uploads on -> the game's casual multiplayer mode");
  assert.equal(found.track.name, "Test Track");
  assert.equal(found.track.category, "official");
  assert.equal(found.track.wr.frames, 60000, "the upcoming track's WR was looked up when it was drawn");
  assert.equal(found.cup.phase, "idle");
  assert.deepEqual(worldRecords.lookups, [TRACK_A]);

  cup.ready("p1");
  assert.equal(cup.phase, CUP_PHASE.IDLE, "one racer is not enough");
  cup.join(player(2));
  assert.equal(cup.phase, CUP_PHASE.IDLE, "a racer who has not loaded does not count");
  cup.ready("p2");
  assert.equal(cup.phase, CUP_PHASE.BREAK);
  assert.equal(cup.cupNumber, 1);
  assert.equal(io.last("p1", MSG.CUP_STATE).cup.nextAt, clock.now() + 5000);

  clock.advance(5000);
  assert.equal(cup.phase, CUP_PHASE.LOADING);
  const start = io.last("p2", MSG.ROUND_START);
  assert.equal(start.round, 1);
  assert.equal(start.trackRound, 1);
  assert.equal(start.track.id, TRACK_A, "round 1 is raced on the track everyone preloaded");
  assert.equal(start.warmup, true);
  assert.equal(start.warmupMs, 84000, "WR 60 s x 1.4");
  assert.deepEqual(start.racers, [1, 2]);
  assert.ok(start.players.every((p) => p.racing));

  cup.roundReady("p1", cup.sessionId, 55000);
  assert.equal(cup.phase, CUP_PHASE.LOADING, "waits for every racer's game");
  cup.roundReady("p2", cup.sessionId, null);
  assert.equal(cup.phase, CUP_PHASE.WARMUP);
  const warm = io.last("p1", MSG.CUP_STATE).cup;
  assert.equal(warm.live.warmupEndsAt, clock.now() + 84000);
  assert.equal(warm.players.find((p) => p.slot === 1).pb, 55000, "personal bests travel with the ready report");
  assert.equal(warm.players.find((p) => p.slot === 2).pb, null);

  cup.warmupReady("p1", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.WARMUP, "one ready racer does not end the warmup");
  assert.deepEqual(io.last("p1", MSG.CUP_STATE).cup.live.warmupReady, [1]);
  cup.warmupReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN, "all ready ends the warmup");
  const countdown = io.last("p1", MSG.CUP_STATE).cup;
  assert.equal(countdown.live.startsAt, clock.now() + 3000);
  clock.advance(3000);
  assert.equal(cup.phase, CUP_PHASE.RACING);
  assert.equal(cup.run.limitAt, cup.run.startsAt + 4 * 60000, "safety limit from the WR");
});

test("a warmup that nobody ends runs its full length; later rounds on the same track have none", () => {
  const { cup, clock } = makeCup({ rules: { readyEndsWarmup: false } });
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  cup.roundReady("p1", cup.sessionId);
  cup.roundReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.WARMUP);
  cup.warmupReady("p1", cup.sessionId);
  cup.warmupReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.WARMUP, "ready does not end the warmup with readyEndsWarmup off");
  clock.advance(84000);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
  clock.advance(3000);
  clock.advance(41000);
  cup.finish("p1", cup.sessionId, 40000);
  cup.finish("p2", cup.sessionId, 41000);
  assert.equal(cup.phase, CUP_PHASE.BREAK);
  clock.advance(5000);
  assert.equal(cup.round, 2);
  assert.equal(cup.trackRounds, 2);
  assert.equal(cup.run.warmup, false, "no warmup on the second round of a track");
  cup.roundReady("p1", cup.sessionId);
  cup.roundReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
});

test("live round: a finish opens the finish window for the others, progress is ranked live, the window closes the round", () => {
  const { cup, io, clock } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  reachRacing(cup, clock);
  const startsAt = cup.run.startsAt;

  assert.equal(cup.finish("p1", cup.sessionId, 90000), false, "a time longer than the race so far cannot be real");
  clock.advance(20000);
  assert.equal(cup.checkpoint("p2", cup.sessionId, 0, 12000), true);
  assert.equal(cup.checkpoint("p1", cup.sessionId, 0, 14000), true);
  let live = io.last("p1", MSG.CUP_STATE).cup.live;
  assert.equal(live.splits[2].bestFrames, 12000);
  assert.equal(live.splits[1].bestFrames, 12000, "the best split at that gate is shared");
  let rows = standings(io.last("p1", MSG.CUP_STATE).cup);
  assert.deepEqual(rows.map((r) => r.slot), [2, 1], "the racer ahead on checkpoints leads the round ranking");
  assert.equal(rows[1].delta, 2000);
  assert.equal(cup.checkpoint("p1", cup.sessionId, 0, 13000), false, "checkpoints only move forward");

  clock.advance(10000);
  assert.equal(cup.finish("p1", cup.sessionId, 30000), true);
  assert.equal(cup.run.deadline, startsAt + 30000 + 10000, "ten seconds for everyone else");
  assert.equal(cup.finish("p1", cup.sessionId, 29000), false, "one finish per racer");
  const records = io.last("p2", MSG.RECORDS);
  assert.deepEqual(records.records, { 1: 30000 });
  rows = standings(io.last("p2", MSG.CUP_STATE).cup);
  assert.equal(rows[0].slot, 1);
  assert.equal(rows[0].gain, 10, "provisional points for the place");
  assert.equal(rows[0].movement, 1, "moved up past the racer who led on checkpoints");
  assert.equal(rows[1].movement, -1);

  clock.advance(10000);
  assert.equal(cup.finish("p2", cup.sessionId, 40500), false, "a finish after the window does not count");
  assert.equal(cup.phase, CUP_PHASE.RACING, "the window plus the late grace is still open");
  clock.advance(1000);
  assert.equal(cup.phase, CUP_PHASE.BREAK);
  const end = io.last("p2", MSG.ROUND_END);
  assert.deepEqual(end.results, [
    { slot: 1, frames: 30000, position: 1, points: 10 },
    { slot: 2, frames: null, position: null, points: 0 },
  ]);
  assert.deepEqual(end.scores.points, { 1: 10, 2: 0 });
  assert.equal(end.nextRoundIn, 5000);
  const state = io.last("p2", MSG.CUP_STATE).cup;
  assert.deepEqual(state.lastRound.dnfs, [2]);
  assert.equal(state.lastRound.movement[1], 0, "still first in the standings");
  assert.equal(state.track.tr.frames, 30000, "the cup's track record");
  assert.deepEqual(state.track.tr.nicknames, ["Player 1"]);
  rows = standings(state);
  assert.equal(rows[0].gain, 10);
  assert.equal(rows[1].dnf, true);
});

test("retiring (T / Backspace) is a DNF and ends the round once everyone is done; exact ties share points", () => {
  const { cup, clock, io } = makeCup({ cup: { maxPlayers: 4 } });
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  joinAndLoad(cup, 3);
  clock.advance(5000);
  reachRacing(cup, clock, ["p1", "p2", "p3"]);
  clock.advance(30000);
  assert.equal(cup.dnf("p3", cup.sessionId), true);
  assert.equal(cup.dnf("p3", cup.sessionId), false, "already out");
  assert.equal(cup.checkpoint("p3", cup.sessionId, 0, 5000), false, "no progress after retiring");
  assert.equal(cup.phase, CUP_PHASE.RACING);
  cup.finish("p1", cup.sessionId, 25000);
  cup.finish("p2", cup.sessionId, 25000);
  assert.equal(cup.phase, CUP_PHASE.BREAK, "everyone finished or retired");
  const end = io.last("p1", MSG.ROUND_END);
  assert.deepEqual(end.scores.points, { 1: 10, 2: 10, 3: 0 });
  assert.equal(end.roundWinner, null, "a tied first is no round winner");
  assert.deepEqual(end.results.map((r) => r.position), [1, 1, null]);
});

test("a new track every roundsPerTrack rounds (with its own warmup), the first racer at the target with a unique lead wins, the cup restarts", () => {
  const { cup, io, clock, worldRecords } = makeCup({ worldRecords: fakeWorldRecords({ [TRACK_A]: 60000 }) });
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  const playRound = (times) => {
    reachRacing(cup, clock);
    clock.advance(30000);
    for (const [id, frames] of Object.entries(times)) if (frames != null) cup.finish(id, cup.sessionId, frames);
    for (const [id, frames] of Object.entries(times)) if (frames == null) cup.dnf(id, cup.sessionId);
    assert.ok(cup.phase === CUP_PHASE.BREAK || cup.phase === CUP_PHASE.COMPLETE, `round ended (${cup.phase})`);
  };
  playRound({ p1: 20000, p2: 21000 }); // 10 / 8
  clock.advance(5000);
  assert.equal(cup.round, 2);
  assert.equal(cup.track.id, TRACK_A, "second round on the same track");
  playRound({ p1: 21000, p2: 20000 }); // 18 / 18 – tied leaders keep racing
  assert.equal(cup.phase, CUP_PHASE.BREAK);
  const end2 = io.last("p1", MSG.ROUND_END);
  assert.equal(end2.nextTrack.id, TRACK_B, "the next track is announced one round ahead");
  assert.equal(worldRecords.lookups.at(-1), TRACK_B, "and its WR requested");
  clock.advance(5000);
  assert.equal(cup.round, 3);
  assert.equal(cup.track.id, TRACK_B);
  assert.equal(cup.trackRounds, 1);
  assert.equal(cup.run.warmup, true, "a fresh track gets a warmup");
  assert.equal(cup.run.warmupMs, 90000, "no WR known for it: the fixed fallback");
  playRound({ p1: 20000, p2: null }); // 28 / 18 -> Player 1 wins
  assert.equal(cup.phase, CUP_PHASE.COMPLETE);
  const over = io.last("p2", MSG.CUP_END);
  assert.equal(over.winner.nickname, "Player 1");
  assert.equal(over.winner.points, 28);
  assert.deepEqual(over.standings.map((s) => [s.nickname, s.points, s.place]), [["Player 1", 28, 1], ["Player 2", 18, 2]]);
  assert.equal(over.nextCupIn, 10000);
  assert.equal(over.nextTrack.id, TRACK_A, "the next cup starts on a fresh track");
  assert.equal(io.last("p1", MSG.CUP_STATE).cup.winner.slot, 1);
  assert.equal(cup.cupsCompleted, 1);

  clock.advance(10000);
  assert.equal(cup.phase, CUP_PHASE.BREAK, "the next cup is scheduled by itself");
  assert.equal(cup.cupNumber, 2);
  assert.deepEqual(cup.pointsBySlot(), { 1: 0, 2: 0 });
  assert.equal(cup.trackRecords.get(TRACK_B)?.tr, null, "cup track records belong to one cup");
  assert.equal(cup.trackRecords.get(TRACK_A)?.wr?.frames, 60000, "world records are kept");
  clock.advance(5000);
  assert.equal(cup.round, 1);
  assert.equal(cup.run.warmup, true);
});

test("late joiners spectate the running round and race from the next one; leaving mid-round is a DNF", () => {
  const { cup, io, clock } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  reachRacing(cup, clock);
  clock.advance(5000);
  assert.equal(cup.join(player(3)).ok, true);
  const found = io.last("p3", MSG.MATCH_FOUND);
  assert.equal(found.phase, "racing");
  assert.equal(found.sessionId, cup.sessionId, "the running session, so the newcomer can watch");
  assert.equal(found.players.find((p) => p.slot === 3).pending, true);
  assert.equal(found.players.find((p) => p.slot === 3).racing, false);
  cup.ready("p3");
  assert.equal(cup.finish("p3", cup.sessionId, 6000), false, "spectators do not score");
  cup.leave("p2");
  assert.deepEqual([...cup.run.dnfs], [2], "leaving a live round retires the racer");
  assert.equal(cup.phase, CUP_PHASE.RACING, "p1 still drives");
  clock.advance(25000);
  cup.finish("p1", cup.sessionId, 30000);
  assert.equal(cup.phase, CUP_PHASE.BREAK);
  assert.deepEqual(cup.pointsBySlot(), { 1: 10, 3: 0 });
  clock.advance(5000);
  assert.deepEqual([...cup.run.racers], [1, 3], "the newcomer races round 2");
  cup.join(player(2));
  assert.equal(cup.pointsOf(cup.members.get("p2")), 0, "points of a leaver are kept for a comeback");
  assert.equal(cup.scores.get("p2"), 0);
});

test("a disconnected racer is DNF after the grace period and leaves the lobby; the round goes on", () => {
  const { cup, io, clock } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  reachRacing(cup, clock);
  clock.advance(5000);
  cup.disconnected("p2");
  assert.equal(cup.phase, CUP_PHASE.RACING);
  assert.equal(io.last("p1", MSG.PLAYER_STATUS).connected, false);
  clock.advance(15000);
  assert.deepEqual(io.removed, ["p2"]);
  assert.deepEqual([...cup.run.dnfs], [2]);
  assert.equal(cup.members.size, 1);
  clock.advance(5000);
  cup.finish("p1", cup.sessionId, 25000);
  assert.equal(cup.phase, CUP_PHASE.IDLE, "alone after the round: waiting for racers");
  assert.deepEqual(cup.pointsBySlot(), { 1: 10 });
});

test("the safety limit ends a round nobody finishes; a racer whose game never loads sits the round out", () => {
  const { cup, clock, io } = makeCup({ cup: { roundLimit: { enabled: true, multiplier: 4, minimumSeconds: 120, withoutWrSeconds: 300 } } });
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  cup.roundReady("p1", cup.sessionId);
  clock.advance(20000); // load grace: p2 never reported its game
  assert.equal(cup.phase, CUP_PHASE.WARMUP);
  assert.deepEqual([...cup.run.racers], [1]);
  cup.warmupReady("p1", cup.sessionId);
  clock.advance(3000);
  assert.equal(cup.phase, CUP_PHASE.RACING);
  clock.advance(240000);
  assert.equal(cup.phase, CUP_PHASE.RACING);
  clock.advance(1000);
  assert.equal(cup.phase, CUP_PHASE.BREAK, "4 x WR after GO");
  const end = io.last("p1", MSG.ROUND_END);
  assert.deepEqual(end.results, [{ slot: 1, frames: null, position: null, points: 0 }]);
});

test("rules can be given as a PolyCup preset; warmup off skips straight to the countdown; car states reach spectators", () => {
  const preset = { format: "polycup-preset", schema: 1, name: "Custom", rules: { ...RULES, warmup: "off", uploadLeaderboardTimes: false, pointsToWin: 120, roundsPerTrack: 4 } };
  const { cup, clock, io } = makeCup({ cup: { preset, rules: null } });
  assert.equal(cup.rules.pointsToWin, 120);
  assert.equal(cup.rules.roundsPerTrack, 4);
  assert.equal(cup.gameMode, 1, "no uploads -> competitive mode");
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  cup.roundReady("p1", cup.sessionId);
  cup.roundReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
  clock.advance(3000);
  cup.join(player(3));
  const bytes = encodeCarBatch(cup.sessionId, 0, [new Uint8Array([1, 2, 3])]);
  cup.carBatch("p1", bytes);
  const targets = io.binary.map((b) => b.to).sort();
  assert.deepEqual(targets, ["p2", "p3"], "racers and spectators see the car");
  assert.equal(decodeCarRelay(io.binary[0].bytes).slot, 1);
  io.binary.length = 0;
  cup.carBatch("p3", encodeCarBatch(cup.sessionId, 0, [new Uint8Array([9])]));
  assert.equal(io.binary.length, 0, "a spectator's car is not relayed");
  const api = cup.publicState();
  assert.equal(api.rules.target, 120);
  assert.equal(api.live.sessionId, cup.sessionId);
  assert.deepEqual(api.live.racers, [1, 2]);
  assert.equal(api.players.find((p) => p.slot === 3).pending, true);
});

test("a racer leaving before GO does not hold the others: loading and warmup gates are re-checked", () => {
  const { cup, clock } = makeCup({ cup: { maxPlayers: 4 } });
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  joinAndLoad(cup, 3);
  clock.advance(5000);
  cup.roundReady("p1", cup.sessionId);
  cup.roundReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.LOADING, "p3's game is not there yet");
  cup.leave("p3");
  assert.equal(cup.phase, CUP_PHASE.WARMUP, "everyone left in the round is ready");
  cup.warmupReady("p1", cup.sessionId);
  cup.disconnected("p2");
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN, "the only connected racer is done practising");
  clock.advance(3000);
  assert.equal(cup.phase, CUP_PHASE.RACING);
  clock.advance(15000); // p2's grace runs out: DNF, p1 keeps racing
  assert.deepEqual([...cup.run.dnfs], [2]);
  assert.equal(cup.phase, CUP_PHASE.RACING);
  clock.advance(10000);
  cup.finish("p1", cup.sessionId, 20000);
  assert.equal(cup.phase, CUP_PHASE.IDLE, "alone afterwards");
  assert.deepEqual(cup.pointsBySlot(), { 1: 10 });
});

test("a round whose racers all leave before GO is voided and the lobby waits", () => {
  const { cup, clock } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000);
  cup.roundReady("p1", cup.sessionId);
  cup.roundReady("p2", cup.sessionId);
  assert.equal(cup.phase, CUP_PHASE.WARMUP);
  cup.leave("p1");
  assert.equal(cup.phase, CUP_PHASE.WARMUP, "p2 may keep practising");
  cup.leave("p2");
  assert.equal(cup.members.size, 0);
  assert.equal(cup.phase, CUP_PHASE.IDLE);
  assert.equal(cup.run, null);
});
