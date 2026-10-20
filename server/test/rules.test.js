import { test } from "node:test";
import assert from "node:assert/strict";
import { rankResults, scoreRound, evaluateMatch, placementsByPoints } from "../src/rules.js";

test("rankResults orders finishers, shares ties, puts DNF last", () => {
  const ranked = rankResults([
    { slot: 1, frames: 50000 },
    { slot: 2, frames: null },
    { slot: 3, frames: 40000 },
    { slot: 4, frames: 50000 },
  ]);
  assert.deepEqual(
    ranked.map((r) => [r.slot, r.position]),
    [
      [3, 1],
      [1, 2],
      [4, 2],
      [2, null],
    ],
  );
});

test("duel scoring: faster wins, tie or double DNF gives no winner", () => {
  const r = scoreRound({ scoring: "duel", entries: [{ slot: 1, frames: 42000, team: 0 }, { slot: 2, frames: 43000, team: 1 }] });
  assert.deepEqual(r.roundWinner, { type: "team", team: 0 });
  assert.equal(r.points[1], 1);
  assert.equal(r.points[2], 0);

  const tie = scoreRound({ scoring: "duel", entries: [{ slot: 1, frames: 42000, team: 0 }, { slot: 2, frames: 42000, team: 1 }] });
  assert.equal(tie.roundWinner, null);

  const dnf = scoreRound({ scoring: "duel", entries: [{ slot: 1, frames: null, team: 0 }, { slot: 2, frames: null, team: 1 }] });
  assert.equal(dnf.roundWinner, null);

  const oneDnf = scoreRound({ scoring: "duel", entries: [{ slot: 1, frames: null, team: 0 }, { slot: 2, frames: 99000, team: 1 }] });
  assert.deepEqual(oneDnf.roundWinner, { type: "team", team: 1 });
});

test("teams scoring: position points, team totals, best-k rule and time tiebreak", () => {
  const table = [6, 5, 4, 3, 2, 1];
  const entries = [
    { slot: 1, frames: 40000, team: 0 }, // 6
    { slot: 2, frames: 41000, team: 1 }, // 5
    { slot: 3, frames: 42000, team: 1 }, // 4
    { slot: 4, frames: 43000, team: 0 }, // 3
    { slot: 5, frames: 44000, team: 0 }, // 2
    { slot: 6, frames: null, team: 1 }, // 0
  ];
  const r = scoreRound({ scoring: "teams", pointsTable: table, entries });
  assert.deepEqual(r.teamPoints, [11, 9]);
  assert.deepEqual(r.roundWinner, { type: "team", team: 0 });
  assert.equal(r.points[6], 0);

  // Team 1 is down to two players: only the best two of team 0 count.
  const short = scoreRound({
    scoring: "teams",
    pointsTable: table,
    entries: [
      { slot: 1, frames: 40000, team: 0 }, // 6
      { slot: 2, frames: 41000, team: 1 }, // 5
      { slot: 3, frames: 42000, team: 1 }, // 4
      { slot: 4, frames: 43000, team: 0 }, // 3
      { slot: 5, frames: 44000, team: 0 }, // 2 (dropped)
    ],
  });
  assert.deepEqual(short.teamPoints, [9, 9]);
  // tie on points -> better best time wins (team 0 has 40000)
  assert.deepEqual(short.roundWinner, { type: "team", team: 0 });
});

test("points scoring awards table points and single round winner", () => {
  const r = scoreRound({
    scoring: "points",
    pointsTable: [10, 6, 4, 3, 2, 1],
    entries: [
      { slot: 1, frames: 50000, team: null },
      { slot: 2, frames: 45000, team: null },
      { slot: 3, frames: null, team: null },
    ],
  });
  assert.equal(r.points[2], 10);
  assert.equal(r.points[1], 6);
  assert.equal(r.points[3], 0);
  assert.deepEqual(r.roundWinner, { type: "player", slot: 2 });
});

test("evaluateMatch: first to roundsToWin, max rounds and forfeits", () => {
  const teamOf = new Map([
    [1, 0],
    [2, 1],
  ]);
  const base = { scoring: "duel", roundsToWin: 4, maxRounds: 9, totalPoints: { 1: 3, 2: 2 }, teamOf, activeSlots: new Set([1, 2]) };
  assert.equal(evaluateMatch({ ...base, roundsPlayed: 5, roundWins: [3, 2] }).finished, false);
  assert.deepEqual(evaluateMatch({ ...base, roundsPlayed: 6, roundWins: [4, 2] }), { finished: true, winner: { type: "team", team: 0 }, reason: "rounds" });
  assert.deepEqual(evaluateMatch({ ...base, roundsPlayed: 9, roundWins: [3, 3], totalPoints: { 1: 3, 2: 3 } }), { finished: true, winner: null, reason: "draw" });
  assert.deepEqual(evaluateMatch({ ...base, roundsPlayed: 9, roundWins: [3, 3], totalPoints: { 1: 4, 2: 3 } }).winner, { type: "team", team: 0 });
  assert.deepEqual(evaluateMatch({ ...base, roundsPlayed: 1, roundWins: [0, 1], activeSlots: new Set([1]) }), { finished: true, winner: { type: "team", team: 0 }, reason: "forfeit" });

  const ffa = { scoring: "points", maxRounds: 3, roundWins: [0, 0], teamOf: new Map(), activeSlots: new Set([1, 2, 3]) };
  assert.equal(evaluateMatch({ ...ffa, roundsPlayed: 2, totalPoints: { 1: 20, 2: 6, 3: 4 } }).finished, false);
  assert.deepEqual(evaluateMatch({ ...ffa, roundsPlayed: 3, totalPoints: { 1: 20, 2: 6, 3: 4 } }).winner, { type: "player", slot: 1 });
  assert.equal(evaluateMatch({ ...ffa, roundsPlayed: 3, totalPoints: { 1: 20, 2: 20, 3: 4 } }).reason, "draw");
});

test("placementsByPoints shares places on ties", () => {
  const places = placementsByPoints({ 1: 10, 2: 16, 3: 10 }, [1, 2, 3]);
  assert.equal(places.get(2), 1);
  assert.equal(places.get(1), 2);
  assert.equal(places.get(3), 2);
});
