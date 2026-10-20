import { test } from "node:test";
import assert from "node:assert/strict";
import { RankedClient } from "../src/client.js";
import { MSG, PROTOCOL_VERSION } from "../../shared/protocol.js";

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type, ev = {}) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  open() {
    this.readyState = 1;
    this.dispatch("open");
  }
  receive(obj) {
    this.dispatch("message", { data: typeof obj === "string" ? obj : JSON.stringify(obj) });
  }
  send(data) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.dispatch("close", { code });
  }
}

function makeClient() {
  const states = [];
  const client = new RankedClient({
    url: () => "ws://test",
    secret: () => "s".repeat(32),
    profile: () => ({ nickname: "Nick", countryCode: "DE", carStyle: "QUJD" }),
    vanilla: () => true,
    gameVersion: "0.6.3",
    modVersion: "0.1.0",
    WebSocketImpl: FakeWebSocket,
  });
  client.on("state", (s) => states.push(s.state));
  return { client, states };
}

test("sends hello on open, becomes ready on welcome, tracks rtt and clock offset", () => {
  const { client, states } = makeClient();
  client.connect();
  const ws = FakeWebSocket.instances.at(-1);
  assert.equal(client.state, "connecting");
  ws.open();
  const hello = JSON.parse(ws.sent[0]);
  assert.equal(hello.type, MSG.HELLO);
  assert.equal(hello.protocol, PROTOCOL_VERSION);
  assert.equal(hello.nickname, "Nick");
  assert.equal(hello.vanilla, true);
  assert.equal(JSON.parse(ws.sent[1]).type, MSG.PING);

  ws.receive({ type: MSG.WELCOME, playerId: "abc", serverTime: Date.now() + 5000, queues: [] });
  assert.equal(client.state, "ready");
  assert.equal(client.playerId, "abc");
  assert.ok(Math.abs(client.serverNow() - Date.now() - 5000) < 50);

  const ping = JSON.parse(ws.sent[1]);
  ws.receive({ type: MSG.PONG, t: ping.t, serverTime: Date.now() + 5000 });
  assert.ok(client.rtt >= 0 && client.rtt < 1000);
  assert.deepEqual(states, ["connecting", "connected", "ready"]);

  let err = null;
  client.on("error", (m) => (err = m));
  ws.receive({ type: MSG.ERROR, code: "x", message: "boom" });
  assert.equal(err.code, "x");
  assert.equal(client.lastError, "boom");

  const got = [];
  client.on(MSG.QUEUE_STATUS, (m) => got.push(m));
  ws.receive({ type: MSG.QUEUE_STATUS, waiting: 1 });
  assert.equal(got.length, 1);

  let bin = null;
  client.on("binary", (b) => (bin = b));
  client.onMessage(new Uint8Array([1, 2]).buffer);
  assert.deepEqual([...bin], [1, 2]);

  ws.close(1006);
  assert.equal(client.state, "disconnected");
  assert.ok(client._reconnectTimer, "schedules a reconnect");
  client.disconnect();
  assert.equal(client._reconnectTimer, null);
  assert.equal(client.autoReconnect, false);
});

test("a replaced connection stops reconnecting", () => {
  const { client } = makeClient();
  client.connect();
  const ws = FakeWebSocket.instances.at(-1);
  ws.open();
  ws.close(4001);
  assert.equal(client.autoReconnect, false);
  assert.equal(client._reconnectTimer, null);
  assert.match(client.lastError, /another tab/);
});
