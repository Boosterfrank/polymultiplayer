import { test } from "node:test";
import assert from "node:assert/strict";
import { Matchmaker } from "../src/matchmaking.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildPool, pickTrack } from "../src/tracks.js";

const queues = DEFAULT_CONFIG.queues;
const mm = () => new Matchmaker(queues, DEFAULT_CONFIG.matchmaking);

test("duel: two close players match immediately, far players wait for the window to grow", () => {
  const m = mm();
  const t0 = 1_000_000;
  m.join("a", "duel", 1000, t0);
  m.join("b", "duel", 1100, t0);
  const formed = m.tick(t0 + 1000);
  assert.equal(formed.length, 1);
  assert.equal(formed[0].queueId, "duel");
  assert.deepEqual(formed[0].players.map((p) => p.playerId).sort(), ["a", "b"]);
  assert.deepEqual(formed[0].players.map((p) => p.team).sort(), [0, 1]);
  assert.equal(m.has("a"), false);

  m.join("c", "duel", 1000, t0);
  m.join("d", "duel", 1600, t0);
  assert.equal(m.tick(t0 + 1000).length, 0); // 600 apart, window 150 each side
  // after 60s each player's window is 150 + 6*50 = 450 >= 300 distance to the mean
  assert.equal(m.tick(t0 + 61_000).length, 1);
});

test("duel: picks the closest pair among several candidates", () => {
  const m = mm();
  const t0 = 0;
  m.join("a", "duel", 1000, t0);
  m.join("b", "duel", 1090, t0);
  m.join("c", "duel", 1100, t0);
  const formed = m.tick(t0 + 100);
  assert.equal(formed.length, 1);
  assert.deepEqual(formed[0].players.map((p) => p.playerId).sort(), ["b", "c"]);
  assert.equal(m.status("duel").waiting, 1);
});

test("teams: six players are split with a snake draft", () => {
  const m = mm();
  const ratings = { p1: 1300, p2: 1250, p3: 1200, p4: 1150, p5: 1100, p6: 1050 };
  for (const [id, r] of Object.entries(ratings)) m.join(id, "teams", r, 0);
  const formed = m.tick(1000);
  assert.equal(formed.length, 1);
  const team0 = formed[0].players.filter((p) => p.team === 0).map((p) => p.playerId).sort();
  const team1 = formed[0].players.filter((p) => p.team === 1).map((p) => p.playerId).sort();
  assert.deepEqual(team0, ["p1", "p4", "p5"]);
  assert.deepEqual(team1, ["p2", "p3", "p6"]);
  const sum = (ids) => ids.reduce((s, id) => s + ratings[id], 0);
  assert.ok(Math.abs(sum(team0) - sum(team1)) <= 100);
});

test("ffa: waits for a full lobby, relaxes to minPlayers after relaxAfterSeconds", () => {
  const m = mm();
  m.join("a", "ffa", 1000, 0);
  m.join("b", "ffa", 1000, 0);
  m.join("c", "ffa", 1000, 0);
  assert.equal(m.tick(1000).length, 0);
  const formed = m.tick(61_000);
  assert.equal(formed.length, 1);
  assert.equal(formed[0].players.length, 3);
  assert.ok(formed[0].players.every((p) => p.team === null));
});

test("leave removes a player; unknown queue throws", () => {
  const m = mm();
  m.join("a", "duel", 1000, 0);
  assert.equal(m.leave("a"), true);
  assert.equal(m.has("a"), false);
  assert.throws(() => m.join("a", "nope", 1000, 0));
});

test("track pool respects tiers, enabled flag and recent ids", () => {
  const pool = buildPool([
    { id: "t1", name: "A", trackUrl: "a", tier: 1 },
    { id: "t2", name: "B", trackUrl: "b", tier: 2 },
    { id: "t3", name: "C", trackUrl: "c", tier: 3, enabled: false },
    { id: "bad" },
  ]);
  assert.equal(pool.length, 3);
  assert.equal(pool[0].roundSeconds, 90);
  const picks = new Set();
  for (let i = 0; i < 50; i++) picks.add(pickTrack(pool, 1, []).id);
  assert.deepEqual([...picks], ["t1"]);
  assert.equal(pickTrack(pool, 2, ["t1"]).id, "t2");
  assert.equal(pickTrack(pool, 3, ["t1", "t2"]).id !== "t3", true); // disabled never picked
  assert.equal(pickTrack([], 1), null);
});
