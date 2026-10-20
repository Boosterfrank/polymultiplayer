import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createServer } from "../src/index.js";
import { MSG, PROTOCOL_VERSION, encodeCarBatch, decodeCarRelay } from "../../shared/protocol.js";
import { testConfig } from "./helpers.js";

class Client {
  constructor(url, secret, nickname) {
    this.ws = new WebSocket(url);
    this.secret = secret;
    this.nickname = nickname;
    this.messages = [];
    this.binary = [];
    this.waiters = [];
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.binary.push(new Uint8Array(data));
        return;
      }
      const msg = JSON.parse(data.toString());
      this.messages.push(msg);
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.once("open", res);
      this.ws.once("error", rej);
    });
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  sendBinary(bytes) {
    this.ws.send(bytes, { binary: true });
  }
  /** Resolve with the first message (already received or future) matching pred. */
  wait(pred, timeoutMs = 5000) {
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        if (this.waiters.includes(w)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          reject(new Error("timeout waiting for " + pred.toString()));
        }
      }, timeoutMs).unref();
    });
  }
  waitType(type, extra = () => true) {
    return this.wait((m) => m.type === type && extra(m));
  }
  hello(extra = {}) {
    this.send({ type: MSG.HELLO, protocol: PROTOCOL_VERSION, secret: this.secret, nickname: this.nickname, countryCode: "SE", carStyle: "AAECAwQFBgcICQ==", gameVersion: "0.6.3", modVersion: "0.1.0", vanilla: true, ...extra });
    return this.waitType(MSG.WELCOME);
  }
  close() {
    this.ws.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(overrides = {}) {
  const cfg = testConfig({
    port: 0,
    host: "127.0.0.1",
    rounds: { countdownSeconds: 0.2, finishGraceSeconds: 0.3, resultsSeconds: 0.2, readyTimeoutSeconds: 5, disconnectGraceSeconds: 1, lateRecordGraceMs: 50 },
    rating: { placementMatches: 1 },
    tracks: [{ id: "c".repeat(64), name: "Quick", trackUrl: "tracks/official/summer1.track", tier: 1, roundSeconds: 3 }],
    ...overrides,
  });
  const server = createServer(cfg, { log: { info() {}, warn() {}, error: console.error }, storePath: null });
  const addr = await server.listen();
  return { server, url: `ws://127.0.0.1:${addr.port}`, http: `http://127.0.0.1:${addr.port}`, cfg };
}

test("two players play a complete ranked duel over real sockets", async () => {
  const { server, url, http } = await startServer({ queues: { duel: { roundsToWin: 2 } } });
  try {
    const a = new Client(url, "secret-aaaaaaaaaaaaaaaaaaaa", "Alice");
    const b = new Client(url, "secret-bbbbbbbbbbbbbbbbbbbb", "Bob");
    await Promise.all([a.open(), b.open()]);
    const [wa, wb] = await Promise.all([a.hello(), b.hello()]);
    assert.equal(wa.canQueue, true);
    assert.equal(wa.profile.nickname, "Alice");
    assert.equal(wa.profile.ratings.duel.rating, 1000);
    assert.ok(wa.queues.find((q) => q.id === "duel"));
    assert.notEqual(wa.playerId, wb.playerId);

    a.send({ type: MSG.QUEUE_JOIN, queue: "duel" });
    b.send({ type: MSG.QUEUE_JOIN, queue: "duel" });
    await a.waitType(MSG.QUEUE_STATUS);
    server.tick();
    const [fa, fb] = await Promise.all([a.waitType(MSG.MATCH_FOUND), b.waitType(MSG.MATCH_FOUND)]);
    assert.equal(fa.matchId, fb.matchId);
    assert.notEqual(fa.you, fb.you);
    assert.equal(fa.track.name, "Quick");

    a.send({ type: MSG.MATCH_READY });
    b.send({ type: MSG.MATCH_READY });
    let round = await a.waitType(MSG.ROUND_START, (m) => m.round === 1);
    await b.waitType(MSG.ROUND_START, (m) => m.round === 1);

    // car relay: a's batch arrives at b with a's slot
    await sleep(Math.max(0, round.startsAt - Date.now()) + 50);
    a.sendBinary(encodeCarBatch(round.sessionId, 0, [new Uint8Array([9, 8, 7])]));
    for (let i = 0; i < 50 && b.binary.length === 0; i++) await sleep(20);
    assert.equal(b.binary.length, 1);
    const relay = decodeCarRelay(b.binary[0]);
    assert.equal(relay.slot, fa.you);
    assert.deepEqual([...relay.states[0]], [9, 8, 7]);

    // round 1: Alice faster
    a.send({ type: MSG.RECORD, sessionId: round.sessionId, frames: 100 });
    b.send({ type: MSG.RECORD, sessionId: round.sessionId, frames: 150 });
    const end1 = await a.waitType(MSG.ROUND_END, (m) => m.round === 1);
    assert.equal(end1.results[0].slot, fa.you);
    assert.equal(end1.matchOver, false);

    // round 2: Alice faster again -> match over
    round = await a.waitType(MSG.ROUND_START, (m) => m.round === 2);
    await sleep(Math.max(0, round.startsAt - Date.now()) + 50);
    a.send({ type: MSG.RECORD, sessionId: round.sessionId, frames: 100 });
    b.send({ type: MSG.RECORD, sessionId: round.sessionId, frames: 150 });
    const [ea, eb] = await Promise.all([a.waitType(MSG.MATCH_END), b.waitType(MSG.MATCH_END)]);
    assert.deepEqual(ea.winner, { type: "team", team: fa.players.find((p) => p.slot === fa.you).team });
    assert.ok(ea.ratings[fa.you].delta > 0);
    assert.ok(eb.ratings[fb.you].delta < 0);
    assert.equal(ea.ratings[fa.you].result, "win");

    // persisted ratings & leaderboard
    const alice = server.players.get(wa.playerId);
    assert.equal(alice.ratings.duel.matches, 1);
    assert.equal(alice.ratings.duel.wins, 1);
    assert.ok(alice.ratings.duel.rating > 1000);
    const lb = await (await fetch(`${http}/api/leaderboard?queue=duel`)).json();
    assert.equal(lb.entries[0].nickname, "Alice");
    assert.equal(lb.entries[1].nickname, "Bob");
    const health = await (await fetch(`${http}/health`)).json();
    assert.equal(health.ok, true);

    // the players can queue again right away
    a.send({ type: MSG.QUEUE_JOIN, queue: "duel" });
    const qs = await a.wait((m) => m.type === MSG.QUEUE_STATUS && m.inQueue && m.waiting === 1);
    assert.equal(qs.queueId, "duel");
    a.close();
    b.close();
  } finally {
    await server.close();
  }
});

test("hello validation, version gating and unknown queues", async () => {
  const { server, url } = await startServer();
  try {
    const c = new Client(url, "short", "X");
    await c.open();
    c.send({ type: MSG.HELLO, protocol: PROTOCOL_VERSION, secret: "short" });
    const err = await c.waitType(MSG.ERROR);
    assert.equal(err.code, "bad_secret");

    const d = new Client(url, "secret-dddddddddddddddddddd", "Dora");
    await d.open();
    const w = await d.hello({ gameVersion: "0.5.0" });
    assert.equal(w.canQueue, false);
    d.send({ type: MSG.QUEUE_JOIN, queue: "duel" });
    const e2 = await d.waitType(MSG.ERROR);
    assert.equal(e2.code, "cannot_queue");

    const e = new Client(url, "secret-eeeeeeeeeeeeeeeeeeee", "Eve");
    await e.open();
    await e.hello();
    e.send({ type: MSG.QUEUE_JOIN, queue: "nope" });
    const e3 = await e.waitType(MSG.ERROR);
    assert.equal(e3.code, "unknown_queue");
    e.send({ type: MSG.PING, t: 123 });
    const pong = await e.waitType(MSG.PONG);
    assert.equal(pong.t, 123);
    assert.ok(typeof pong.serverTime === "number");
    c.close();
    d.close();
    e.close();
  } finally {
    await server.close();
  }
});

test("a second connection with the same identity replaces the first; leaving mid-match forfeits", async () => {
  const { server, url } = await startServer();
  try {
    const a1 = new Client(url, "secret-ffffffffffffffffffff", "Fay");
    await a1.open();
    await a1.hello();
    const a2 = new Client(url, "secret-ffffffffffffffffffff", "Fay");
    await a2.open();
    await a2.hello();
    const replaced = await a1.waitType(MSG.ERROR);
    assert.equal(replaced.code, "replaced");

    const b = new Client(url, "secret-gggggggggggggggggggg", "Gus");
    await b.open();
    await b.hello();
    a2.send({ type: MSG.QUEUE_JOIN, queue: "duel" });
    b.send({ type: MSG.QUEUE_JOIN, queue: "duel" });
    await b.waitType(MSG.QUEUE_STATUS);
    server.tick();
    await Promise.all([a2.waitType(MSG.MATCH_FOUND), b.waitType(MSG.MATCH_FOUND)]);
    a2.send({ type: MSG.MATCH_READY });
    b.send({ type: MSG.MATCH_READY });
    await b.waitType(MSG.ROUND_START);
    b.send({ type: MSG.LEAVE_MATCH });
    const end = await a2.waitType(MSG.MATCH_END);
    assert.equal(end.reason, "forfeit");
    a2.close();
    b.close();
  } finally {
    await server.close();
  }
});
