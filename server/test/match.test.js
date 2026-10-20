import { test } from "node:test";
import assert from "node:assert/strict";
import { Match, PHASE } from "../src/match.js";
import { MSG, encodeCarBatch, decodeCarRelay } from "../../shared/protocol.js";
import { FakeClock, FakeIO, testConfig, makePlayers } from "./helpers.js";

function duel(overrides = {}) {
  const cfg = testConfig(overrides);
  const clock = new FakeClock();
  const io = new FakeIO();
  const players = makePlayers(2);
  const match = new Match({ id: "m1", seq: 1, queueId: "duel", queue: cfg.queues.duel, cfg, players, track: { ...cfg.tracks[0] }, pool: cfg.tracks, io, clock, log: { error() {}, info() {} } });
  return { cfg, clock, io, match, players };
}

test("match_found is sent to everyone with their own slot, then round 1 starts when all are ready", () => {
  const { match, io, clock, cfg } = duel();
  match.start();
  const found1 = io.last("p1", MSG.MATCH_FOUND);
  const found2 = io.last("p2", MSG.MATCH_FOUND);
  assert.equal(found1.you, 1);
  assert.equal(found2.you, 2);
  assert.equal(found1.players.length, 2);
  assert.equal(found1.track.name, "Test Track");
  assert.equal(match.phase, PHASE.LOADING);

  match.ready("p1");
  assert.equal(match.phase, PHASE.LOADING);
  match.ready("p2");
  assert.equal(match.phase, PHASE.COUNTDOWN);
  const start = io.last("p1", MSG.ROUND_START);
  assert.equal(start.round, 1);
  assert.equal(start.startsAt, clock.now() + cfg.rounds.countdownSeconds * 1000);
  assert.equal(start.endsAt, start.startsAt + 60_000);
  assert.equal(start.sessionId, match.sessionId);
  assert.ok(start.sessionId > 0);

  clock.advance(cfg.rounds.countdownSeconds * 1000);
  assert.equal(match.phase, PHASE.RACING);
});

test("a full duel: records, early round end, scores, match end with rating changes", () => {
  const { match, io, clock, cfg } = duel({ queues: { duel: { roundsToWin: 2, maxRounds: 5 } } });
  match.start();
  match.ready("p1");
  match.ready("p2");
  clock.advance(3000);

  // Records during countdown or with impossible times are ignored
  clock.advance(5000);
  match.record("p1", match.sessionId, 70_000); // longer than elapsed time
  assert.equal(match.records.size, 0);
  match.record("p1", match.sessionId + 1, 4000); // wrong session
  assert.equal(match.records.size, 0);

  match.record("p1", match.sessionId, 4000);
  match.record("p2", match.sessionId, 4500);
  const rec = io.last("p2", MSG.RECORDS);
  assert.deepEqual(rec.records, { 1: 4000, 2: 4500 });
  // everyone finished -> the round is shortened to finishGraceSeconds
  const clockMsg = io.last("p1", MSG.ROUND_CLOCK);
  assert.equal(clockMsg.endsAt, clock.now() + cfg.rounds.finishGraceSeconds * 1000);

  // an improvement still counts, a worse time does not
  match.record("p2", match.sessionId, 3900);
  match.record("p2", match.sessionId, 3950);
  assert.equal(match.records.get(2), 3900);

  clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs);
  const end1 = io.last("p1", MSG.ROUND_END);
  assert.equal(end1.round, 1);
  assert.deepEqual(end1.roundWinner, { type: "team", team: 1 });
  assert.deepEqual(end1.scores.roundWins, [0, 1]);
  assert.equal(end1.results[0].slot, 2);
  assert.equal(end1.results[0].points, 1);
  assert.equal(end1.matchOver, false);
  assert.equal(match.phase, PHASE.RESULTS);

  // next round after resultsSeconds
  clock.advance(cfg.rounds.resultsSeconds * 1000);
  assert.equal(match.phase, PHASE.COUNTDOWN);
  const start2 = io.last("p1", MSG.ROUND_START);
  assert.equal(start2.round, 2);
  assert.notEqual(start2.sessionId, end1.sessionId);
  clock.advance(3000 + 2000);
  match.record("p2", match.sessionId, 1500);
  // p1 never finishes -> round ends at the clock
  clock.advance(60_000);
  const end2 = io.last("p1", MSG.ROUND_END);
  assert.equal(end2.round, 2);
  assert.equal(end2.matchOver, true);
  assert.equal(match.phase, PHASE.FINISHED);

  const final = io.last("p1", MSG.MATCH_END);
  assert.deepEqual(final.winner, { type: "team", team: 1 });
  assert.equal(final.reason, "rounds");
  assert.ok(final.ratings[2].delta > 0);
  assert.ok(final.ratings[1].delta < 0);
  assert.equal(final.ratings[2].result, "win");
  assert.equal(final.ratings[1].result, "loss");
  assert.equal(io.finished.id, "m1");
  assert.equal(io.finished.rounds.length, 2);
  assert.deepEqual(io.finished.ratings.find((r) => r.id === "p2").result, "win");
});

test("car batches are relayed to opponents with the sender slot, wrong sessions dropped", () => {
  const { match, io, clock } = duel();
  match.start();
  match.ready("p1");
  match.ready("p2");
  clock.advance(3000);
  const batch = encodeCarBatch(match.sessionId, 0, [new Uint8Array([1, 2, 3, 4])]);
  match.carBatch("p1", batch);
  assert.equal(io.binary.length, 1);
  assert.equal(io.binary[0].to, "p2");
  const relay = decodeCarRelay(io.binary[0].bytes);
  assert.equal(relay.slot, 1);
  assert.deepEqual([...relay.states[0]], [1, 2, 3, 4]);

  match.carBatch("p2", encodeCarBatch(match.sessionId + 7, 0, [new Uint8Array([1])]));
  assert.equal(io.binary.length, 1);

  match.carReset("p2", match.sessionId, 3);
  const reset = io.last("p1", MSG.CAR_RESET);
  assert.deepEqual({ slot: reset.slot, resetCounter: reset.resetCounter }, { slot: 2, resetCounter: 3 });
});

test("leaving forfeits the match; disconnect grace allows reconnecting", () => {
  const a = duel();
  a.match.start();
  a.match.ready("p1");
  a.match.ready("p2");
  a.clock.advance(4000);
  a.match.leave("p2");
  assert.equal(a.match.phase, PHASE.FINISHED);
  const end = a.io.last("p1", MSG.MATCH_END);
  assert.equal(end.reason, "forfeit");
  assert.deepEqual(end.winner, { type: "team", team: 0 });
  assert.ok(a.io.last("p1", MSG.PLAYER_LEFT).slot === 2);

  const b = duel();
  b.match.start();
  b.match.ready("p1");
  b.match.ready("p2");
  b.clock.advance(4000);
  b.match.disconnected("p2");
  assert.equal(b.match.phase, PHASE.RACING);
  b.clock.advance(5000);
  assert.equal(b.match.reconnected("p2"), true);
  const resume = b.io.last("p2", MSG.MATCH_RESUME);
  assert.equal(resume.round, 1);
  assert.equal(resume.you, 2);
  assert.equal(resume.phase, PHASE.RACING);
  b.clock.advance(20_000);
  assert.equal(b.match.phase, PHASE.RACING);

  const c = duel();
  c.match.start();
  c.match.ready("p1");
  c.match.ready("p2");
  c.clock.advance(4000);
  c.match.disconnected("p2");
  c.clock.advance(c.cfg.rounds.disconnectGraceSeconds * 1000 + 1);
  assert.equal(c.match.phase, PHASE.FINISHED);
  assert.equal(c.io.last("p1", MSG.MATCH_END).reason, "forfeit");
});

test("players that never load are dropped at the ready timeout", () => {
  const { match, io, clock, cfg } = duel();
  match.start();
  match.ready("p1");
  clock.advance(cfg.rounds.readyTimeoutSeconds * 1000);
  assert.equal(match.phase, PHASE.FINISHED);
  assert.equal(io.last("p1", MSG.MATCH_END).reason, "forfeit");
});

test("ffa match plays maxRounds and ranks by points", () => {
  const cfg = testConfig({ queues: { ffa: { maxRounds: 2 } } });
  const clock = new FakeClock();
  const io = new FakeIO();
  const players = makePlayers(3, { teams: false });
  const match = new Match({ id: "m2", seq: 2, queueId: "ffa", queue: cfg.queues.ffa, cfg, players, track: { ...cfg.tracks[0] }, pool: cfg.tracks, io, clock, log: { error() {}, info() {} } });
  match.start();
  for (const p of players) match.ready(p.id);
  for (let round = 1; round <= 2; round++) {
    clock.advance(3000 + 2000);
    match.record("p1", match.sessionId, 1000);
    match.record("p2", match.sessionId, 1200);
    match.record("p3", match.sessionId, 1400);
    clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs);
    if (round === 1) clock.advance(cfg.rounds.resultsSeconds * 1000);
  }
  const end = io.last("p1", MSG.MATCH_END);
  assert.deepEqual(end.winner, { type: "player", slot: 1 });
  assert.deepEqual(end.scores.points, { 1: 20, 2: 12, 3: 8 });
  assert.ok(end.ratings[1].delta > 0 && end.ratings[3].delta < 0);
});

test("trackPerRound picks a different track for round 2", () => {
  const { match, io, clock, cfg } = duel({ trackPerRound: true, queues: { duel: { roundsToWin: 3 } } });
  match.start();
  match.ready("p1");
  match.ready("p2");
  clock.advance(3000 + 2000);
  match.record("p1", match.sessionId, 1000);
  match.record("p2", match.sessionId, 1100);
  clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs + cfg.rounds.resultsSeconds * 1000);
  const start2 = io.last("p1", MSG.ROUND_START);
  assert.equal(start2.round, 2);
  assert.equal(start2.track.name, "Second Track");
});
