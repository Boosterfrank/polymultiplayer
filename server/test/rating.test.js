import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedScore, computeRatingChanges, divisionFor, describeRating } from "../src/rating.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const cfg = DEFAULT_CONFIG.rating;

test("expectedScore is symmetric and 0.5 for equal ratings", () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  assert.ok(Math.abs(expectedScore(1200, 1000) + expectedScore(1000, 1200) - 1) < 1e-9);
  assert.ok(expectedScore(1400, 1000) > 0.9);
});

test("duel: equal players exchange K/2, placement K is higher", () => {
  const changes = computeRatingChanges({
    mode: "duel",
    participants: [
      { id: "a", rating: 1000, matches: 10, team: 0, points: 4, place: null },
      { id: "b", rating: 1000, matches: 10, team: 1, points: 1, place: null },
    ],
    winnerTeam: 0,
    cfg,
  });
  assert.equal(changes.get("a").delta, 10);
  assert.equal(changes.get("b").delta, -10);

  const placement = computeRatingChanges({
    mode: "duel",
    participants: [
      { id: "a", rating: 1000, matches: 0, team: 0, points: 4, place: null },
      { id: "b", rating: 1000, matches: 10, team: 1, points: 1, place: null },
    ],
    winnerTeam: 0,
    cfg,
  });
  assert.equal(placement.get("a").delta, 20);
  assert.equal(placement.get("b").delta, -10);
});

test("duel: upset win pays more than expected win, draws move toward equality", () => {
  const upset = computeRatingChanges({
    mode: "duel",
    participants: [
      { id: "a", rating: 900, matches: 10, team: 0, points: 0, place: null },
      { id: "b", rating: 1100, matches: 10, team: 1, points: 0, place: null },
    ],
    winnerTeam: 0,
    cfg,
  });
  assert.ok(upset.get("a").delta > 10);
  const draw = computeRatingChanges({
    mode: "duel",
    participants: [
      { id: "a", rating: 900, matches: 10, team: 0, points: 0, place: null },
      { id: "b", rating: 1100, matches: 10, team: 1, points: 0, place: null },
    ],
    winnerTeam: null,
    cfg,
  });
  assert.ok(draw.get("a").delta > 0 && draw.get("b").delta < 0);
});

test("teams: winners gain, losers lose, better performers gain more / lose less", () => {
  const participants = [
    { id: "a1", rating: 1000, matches: 10, team: 0, points: 30 },
    { id: "a2", rating: 1000, matches: 10, team: 0, points: 20 },
    { id: "a3", rating: 1000, matches: 10, team: 0, points: 10 },
    { id: "b1", rating: 1000, matches: 10, team: 1, points: 25 },
    { id: "b2", rating: 1000, matches: 10, team: 1, points: 15 },
    { id: "b3", rating: 1000, matches: 10, team: 1, points: 5 },
  ];
  const ch = computeRatingChanges({ mode: "teams", participants, winnerTeam: 0, cfg });
  assert.ok(ch.get("a1").delta >= ch.get("a2").delta && ch.get("a2").delta >= ch.get("a3").delta);
  assert.ok(ch.get("a3").delta > 0);
  assert.ok(ch.get("b1").delta < 0 && ch.get("b3").delta < 0);
  assert.ok(ch.get("b1").delta > ch.get("b3").delta); // best loser loses least
});

test("ffa: pairwise Elo, first place gains most, last loses most", () => {
  const participants = [
    { id: "a", rating: 1000, matches: 10, team: null, points: 30, place: 1 },
    { id: "b", rating: 1000, matches: 10, team: null, points: 20, place: 2 },
    { id: "c", rating: 1000, matches: 10, team: null, points: 10, place: 3 },
    { id: "d", rating: 1000, matches: 10, team: null, points: 0, place: 4 },
  ];
  const ch = computeRatingChanges({ mode: "ffa", participants, cfg });
  assert.ok(ch.get("a").delta > ch.get("b").delta && ch.get("b").delta > ch.get("c").delta && ch.get("c").delta > ch.get("d").delta);
  assert.equal(ch.get("a").delta, -ch.get("d").delta);
  const total = [...ch.values()].reduce((s, c) => s + c.delta, 0);
  assert.equal(total, 0);
});

test("divisions and placement labels", () => {
  assert.equal(divisionFor(1000, 10, cfg).name, "Silver I");
  assert.equal(divisionFor(700, 10, cfg).name, "Bronze I");
  assert.equal(divisionFor(1850, 10, cfg).name, "Trackmaster");
  assert.equal(divisionFor(1849, 10, cfg).name, "Master III");
  const unranked = divisionFor(1000, 2, cfg);
  assert.equal(unranked.placement, true);
  assert.match(unranked.label, /Unranked \(2\/5\)/);
  assert.equal(divisionFor(1225, 10, cfg).tier, 3);
  const described = describeRating(undefined, cfg);
  assert.equal(described.rating, cfg.initial);
  assert.equal(described.matches, 0);
});
