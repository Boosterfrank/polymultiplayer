import { test } from "node:test";
import assert from "node:assert/strict";
import { Cup, CUP_PHASE } from "../src/cup.js";
import { MSG, encodeCarBatch, decodeCarRelay } from "../../shared/protocol.js";
import { buildPool } from "../src/tracks.js";
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

function makeCup(overrides = {}) {
  const cfg = testConfig({
    cup: { enabled: true, name: "Test Cup", minPlayers: 2, maxPlayers: 3, roundsPerTrack: 2, target: 20, pointsTable: [10, 8, 6], waitSeconds: 5, breakSeconds: 10, idleResetSeconds: 60 },
    ...overrides,
  });
  const clock = new FakeClock();
  const io = new CupIO();
  // deterministic track draws: always the first candidate
  const cup = new Cup({ cfg, pool: buildPool(cfg.tracks), io, clock, log: { info() {}, error() {} }, rng: () => 0 });
  return { cfg, clock, io, cup };
}

const player = (n) => ({ id: `p${n}`, nickname: `Player ${n}`, countryCode: null, carStyle: null });

function joinAndLoad(cup, n) {
  assert.equal(cup.join(player(n)).ok, true);
  cup.ready(`p${n}`);
}

test("the lobby waits for enough loaded racers, then starts round 1 after waitSeconds", () => {
  const { cup, io, clock, cfg } = makeCup();
  assert.equal(cup.phase, CUP_PHASE.IDLE);
  assert.equal(cup.join(player(1)).ok, true);
  const found = io.last("p1", MSG.MATCH_FOUND);
  assert.equal(found.you, 1);
  assert.equal(found.format.cup, true);
  assert.equal(found.format.target, 20);
  assert.equal(found.track.name, "Test Track");
  assert.equal(found.cup.phase, "idle");

  cup.ready("p1");
  assert.equal(cup.phase, CUP_PHASE.IDLE, "one racer is not enough");
  cup.join(player(2));
  assert.equal(cup.phase, CUP_PHASE.IDLE, "a racer who has not loaded does not count");
  cup.ready("p2");
  assert.equal(cup.phase, CUP_PHASE.STARTING);
  assert.equal(cup.cupNumber, 1);
  assert.equal(io.last("p1", MSG.CUP_STATE).cup.nextAt, clock.now() + 5000);

  clock.advance(5000);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
  const start = io.last("p2", MSG.ROUND_START);
  assert.equal(start.round, 1);
  assert.equal(start.track.id, found.track.id, "round 1 is raced on the track everyone preloaded");
  assert.equal(start.players.length, 2);
  assert.ok(start.players.every((p) => p.racing));
  clock.advance(cfg.rounds.countdownSeconds * 1000);
  assert.equal(cup.phase, CUP_PHASE.RACING);
});

test("places score points, a new track every roundsPerTrack rounds, the first at the target wins and the cup restarts", () => {
  const { cup, io, clock, cfg } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000 + cfg.rounds.countdownSeconds * 1000);
  const track1 = cup.track.id;

  const playRound = (winner, loser) => {
    clock.advance(4000);
    cup.record(winner, cup.sessionId, 3000);
    cup.record(loser, cup.sessionId, 3500);
    // everyone finished -> round shortened to finishGraceSeconds, then results
    clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs);
    assert.ok([CUP_PHASE.RESULTS, CUP_PHASE.COMPLETE].includes(cup.phase), cup.phase);
    return io.last("p1", MSG.ROUND_END);
  };

  const end1 = playRound("p1", "p2");
  assert.deepEqual(end1.scores.points, { 1: 10, 2: 8 });
  assert.equal(end1.nextTrack, null, "still one round to go on this track");
  assert.equal(end1.cupOver, false);
  clock.advance(cfg.rounds.resultsSeconds * 1000);
  assert.equal(cup.round, 2);
  assert.equal(cup.track.id, track1, "second round on the same track");

  const end2 = playRound("p1", "p2");
  assert.deepEqual(end2.scores.points, { 1: 20, 2: 16 });
  assert.equal(end2.cupOver, true, "20 points reached with a unique lead");
  assert.equal(cup.phase, CUP_PHASE.COMPLETE);
  const cupEnd = io.last("p2", MSG.CUP_END);
  assert.equal(cupEnd.winner.id, "p1");
  assert.equal(cupEnd.standings[0].nickname, "Player 1");
  assert.equal(cupEnd.standings[0].place, 1);
  assert.equal(cupEnd.standings[1].place, 2);
  assert.equal(cupEnd.nextCupIn, 10_000);
  assert.notEqual(cupEnd.nextTrack.id, track1, "the next cup is announced with its fresh track");
  assert.equal(io.cups.length, 1);
  assert.equal(io.cups[0].winner.nickname, "Player 1");

  // after the break everything resets and the next cup starts by itself
  clock.advance(10_000);
  assert.equal(cup.phase, CUP_PHASE.STARTING);
  assert.equal(cup.cupNumber, 2);
  clock.advance(5000);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
  const start = io.last("p1", MSG.ROUND_START);
  assert.equal(start.round, 1);
  assert.deepEqual(start.scores.points, { 1: 0, 2: 0 });
  assert.equal(start.track.id, cupEnd.nextTrack.id);
});

test("a tied lead at the target continues the cup", () => {
  const { cup, clock, cfg } = makeCup({ cup: { target: 10, pointsTable: [10, 10] } });
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000 + cfg.rounds.countdownSeconds * 1000 + 4000);
  cup.record("p1", cup.sessionId, 3000);
  cup.record("p2", cup.sessionId, 3000); // exact tie shares first place
  clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs);
  assert.equal(cup.phase, CUP_PHASE.RESULTS);
  assert.deepEqual(cup.pointsBySlot(), { 1: 10, 2: 10 });
  clock.advance(cfg.rounds.resultsSeconds * 1000);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN, "no unique leader -> another round");
});

test("late joiners race from the next round; leavers keep their points for a comeback", () => {
  const { cup, io, clock, cfg } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000 + cfg.rounds.countdownSeconds * 1000);
  assert.equal(cup.phase, CUP_PHASE.RACING);

  // p3 joins mid-round: gets the current track, is not racing yet, receives no car relays
  assert.equal(cup.join(player(3)).ok, true);
  cup.ready("p3");
  assert.equal(io.last("p3", MSG.MATCH_FOUND).cup.players.find((p) => p.id === "p3").racing, false);
  cup.carBatch("p1", encodeCarBatch(cup.sessionId, 0, [new Uint8Array([1, 2, 3])]));
  assert.equal(io.binary.filter((b) => b.to === "p3").length, 0);
  assert.equal(io.binary.filter((b) => b.to === "p2").length, 1);
  assert.equal(decodeCarRelay(io.binary[0].bytes).slot, 1);

  clock.advance(4000);
  cup.record("p1", cup.sessionId, 3000);
  cup.record("p3", cup.sessionId, 2000); // spectators cannot score
  cup.record("p2", cup.sessionId, 3500);
  clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs);
  assert.deepEqual(cup.pointsBySlot(), { 1: 10, 2: 8, 3: 0 });

  // p2 leaves with 8 points, p3 races round 2
  cup.leave("p2");
  assert.deepEqual(io.removed, ["p2"]);
  assert.equal(io.last("p1", MSG.PLAYER_LEFT).slot, 2);
  clock.advance(cfg.rounds.resultsSeconds * 1000);
  assert.equal(cup.phase, CUP_PHASE.COUNTDOWN);
  assert.deepEqual([...cup.racing].sort(), [1, 3]);

  // p2 comes back (new slot, same points) and is in from round 3
  assert.equal(cup.join(player(2)).ok, true);
  cup.ready("p2");
  const back = cup.members.get("p2");
  assert.equal(back.slot, 2, "the freed slot is reused");
  assert.equal(cup.pointsOf(back), 8);
  assert.equal(io.last("p1", MSG.CUP_STATE).cup.standings.find((s) => s.id === "p2").points, 8);
});

test("the cup is full at maxPlayers and pauses when racers drop below the minimum", () => {
  const { cup, io, clock, cfg } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  joinAndLoad(cup, 3);
  const full = cup.join(player(4));
  assert.equal(full.ok, false);
  assert.equal(full.code, "cup_full");

  clock.advance(5000 + cfg.rounds.countdownSeconds * 1000);
  cup.leave("p2");
  cup.leave("p3");
  assert.equal(cup.phase, CUP_PHASE.RACING, "a round in progress finishes");
  clock.advance(60_000 + cfg.rounds.lateRecordGraceMs);
  assert.equal(cup.phase, CUP_PHASE.RESULTS);
  clock.advance(cfg.rounds.resultsSeconds * 1000);
  assert.equal(cup.phase, CUP_PHASE.IDLE, "alone -> waiting for racers");
  assert.equal(cup.round, 1, "the cup is not reset while someone stays");

  // a second racer arrives: the cup continues at round 2
  joinAndLoad(cup, 2);
  assert.equal(cup.phase, CUP_PHASE.STARTING);
  clock.advance(5000);
  assert.equal(io.last("p1", MSG.ROUND_START).round, 2);
});

test("disconnects keep the seat for the grace period; an empty lobby forgets the standings after idleResetSeconds", () => {
  const { cup, io, clock, cfg } = makeCup();
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000 + cfg.rounds.countdownSeconds * 1000 + 4000);
  cup.record("p1", cup.sessionId, 3000);
  cup.record("p2", cup.sessionId, 3500);
  clock.advance(cfg.rounds.finishGraceSeconds * 1000 + cfg.rounds.lateRecordGraceMs);
  assert.deepEqual(cup.pointsBySlot(), { 1: 10, 2: 8 });

  cup.disconnected("p2");
  assert.equal(io.last("p1", MSG.PLAYER_STATUS).connected, false);
  clock.advance(1000);
  assert.equal(cup.reconnected("p2"), true);
  const resume = io.last("p2", MSG.MATCH_RESUME);
  assert.equal(resume.you, 2);
  assert.equal(resume.scores.points[2], 8);
  assert.equal(cup.members.size, 2);

  cup.disconnected("p2");
  clock.advance(cfg.rounds.disconnectGraceSeconds * 1000);
  assert.equal(cup.members.size, 1, "removed after the grace period");
  assert.equal(cup.reconnected("p2"), false);

  cup.leave("p1");
  assert.equal(cup.members.size, 0);
  assert.equal(cup.phase, CUP_PHASE.IDLE);
  assert.equal(cup.pointsOf({ id: "p1" }), 10, "standings survive a short empty spell");
  clock.advance(60_000);
  assert.equal(cup.pointsOf({ id: "p1" }), 0, "forgotten once the lobby stayed empty");
  assert.equal(cup.round, 0);
});

test("publicState describes the lobby for the Join button", () => {
  const { cup, clock, cfg } = makeCup();
  const idle = cup.publicState();
  assert.equal(idle.enabled, true);
  assert.equal(idle.phase, "idle");
  assert.equal(idle.players.length, 0);
  assert.equal(idle.track.name, "Test Track");
  joinAndLoad(cup, 1);
  joinAndLoad(cup, 2);
  clock.advance(5000 + cfg.rounds.countdownSeconds * 1000);
  const racing = cup.publicState();
  assert.equal(racing.phase, "racing");
  assert.equal(racing.round, 1);
  assert.equal(racing.trackRounds, 1);
  assert.equal(racing.roundsPerTrack, 2);
  assert.equal(racing.target, 20);
  assert.equal(racing.endsAt, cup.endsAt);
  assert.equal(racing.standings.length, 2);
});
