import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorldRecords, LEADERBOARD_URL } from "../src/worldrecords.js";
import { cupPool } from "../src/index.js";
import { buildPool } from "../src/tracks.js";
import { testConfig } from "./helpers.js";
import { JsonStore } from "../src/store.js";
import { PlayerRegistry } from "../src/players.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const entry = (frames, nickname = "cheesebob", countryCode = "DE") => ({ total: 1, entries: [{ id: 1, userId: "u", nickname, frames, time: frames / 1000, carStyle: "", verifiedState: 1, countryCode }] });

test("world records are fetched like the game does, with the PolyModLoader origin, and cached per track", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => entry(76430) };
  };
  let t = 1000;
  const wr = createWorldRecords({ fetchImpl, now: () => t, cacheSeconds: 100, log: { warn() {} } });
  const ready = [];
  assert.equal(wr.lookup("abc", { verified: true, onReady: (r) => ready.push(r) }), null, "nothing known yet");
  assert.equal(wr.lookup("abc", { verified: true }), null, "a second lookup joins the pending request");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${LEADERBOARD_URL}?version=0.6.3&trackId=abc&skip=0&amount=1&onlyVerified=true`);
  assert.equal(calls[0].init.headers.origin, "https://app-polytrack-desktop.polymodloader.com");
  assert.deepEqual(ready, [{ status: "ready", frames: 76430, nickname: "cheesebob", countryCode: "de" }]);
  assert.deepEqual(wr.lookup("abc"), { status: "ready", frames: 76430, nickname: "cheesebob", countryCode: "de" });
  t += 101_000;
  assert.equal(wr.lookup("abc"), null, "expired: fetched again");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 2);
});

test("an unreachable leaderboard is reported as unavailable and retried after a minute; an empty board is 'missing'", async () => {
  let fail = true;
  const fetchImpl = async () => (fail ? { ok: false, status: 403 } : { ok: true, json: async () => ({ total: 0, entries: [] }) });
  let t = 0;
  const wr = createWorldRecords({ fetchImpl, now: () => t, cacheSeconds: 900, log: { warn() {} } });
  wr.lookup("x");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(wr.peek("x"), { status: "unavailable" });
  t = 61_000;
  fail = false;
  assert.equal(wr.lookup("x"), null);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(wr.peek("x"), { status: "missing" });
  const off = createWorldRecords({ enabled: false });
  assert.deepEqual(off.lookup("x"), { status: "unavailable" });
});

test("the cup draws from the categories of its rules: official from the server list, community from the shipped list", () => {
  const cfg = testConfig();
  const community = [{ id: "c".repeat(64), name: "Zenith", trackUrl: "tracks/community/zenith.track" }];
  const ranked = buildPool(cfg.tracks);
  assert.deepEqual(cupPool(cfg, ranked, community).map((t) => [t.name, t.category]), [["Test Track", "official"], ["Second Track", "official"], ["Zenith", "community"]]);
  cfg.cup.rules = { pool: ["community"] };
  assert.deepEqual(cupPool(cfg, ranked, community).map((t) => t.name), ["Zenith"]);
  cfg.cup.rules = { pool: ["custom"] };
  cfg.cup.customTracks = [{ id: "d".repeat(64), name: "Mine", trackCode: "PolyTrack1..." }];
  assert.deepEqual(cupPool(cfg, ranked, community).map((t) => [t.name, t.category]), [["Mine", "custom"]]);
  cfg.cup.tracks = [{ id: "e".repeat(64), name: "Only", trackUrl: "tracks/official/summer1.track" }];
  assert.deepEqual(cupPool(cfg, ranked, community).map((t) => t.name), ["Only"]);
});

test("cup track records and recent cups are written to the JSON store and read back after a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polyranked-store-"));
  const file = path.join(dir, "polyranked.json");
  const store = new JsonStore(file, { log: { error() {} } });
  store.load();
  const players = new PlayerRegistry(store, testConfig().rating);
  players.setCupRecord("t1", { frames: 12345, playerId: "p9", nickname: "cheesebob", countryCode: "de", setAt: 1, cupNumber: 3, round: 2 });
  players.recordCup({ cupNumber: 3, winner: { nickname: "cheesebob" } });
  store.close();
  const again = new JsonStore(file, { log: { error() {} } });
  again.load();
  const reloaded = new PlayerRegistry(again, testConfig().rating);
  assert.equal(reloaded.cupRecord("t1").nickname, "cheesebob");
  assert.equal(reloaded.cupRecord("t1").frames, 12345);
  assert.equal(again.data.cups.length, 1, "the recent cups list survives too");
  assert.equal(reloaded.cupRecord("nope"), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
