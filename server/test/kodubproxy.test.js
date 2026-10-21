import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { createServer } from "../src/index.js";
import { testConfig } from "./helpers.js";

/** A fake "vps.kodub.com": answers HTTP and WebSocket only for the expected Origin. */
function fakeUpstream(expectedOrigin) {
  return new Promise((resolve) => {
    const seen = { http: [], ws: [] };
    const srv = http.createServer((req, res) => {
      seen.http.push({ url: req.url, origin: req.headers.origin, method: req.method });
      if (req.headers.origin !== expectedOrigin) {
        res.writeHead(403);
        return res.end("forbidden");
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, url: req.url, body }));
      });
    });
    const wss = new WebSocketServer({ noServer: true });
    srv.on("upgrade", (req, socket, head) => {
      seen.ws.push({ url: req.url, origin: req.headers.origin });
      if (req.headers.origin !== expectedOrigin) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ type: "hello-from-upstream" }));
        ws.on("message", (data) => ws.send("echo:" + data.toString()));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, wss, seen, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("kodub proxy forwards HTTP and WebSocket traffic with the configured Origin", async () => {
  const ORIGIN = "https://allowed.example";
  const up = await fakeUpstream(ORIGIN);
  const cfg = testConfig({ port: 0, host: "127.0.0.1", kodubProxy: { enabled: true, path: "/kodub", upstream: up.url, origin: ORIGIN } });
  const server = createServer(cfg, { log: { info() {}, warn() {}, error: console.error }, storePath: null });
  const addr = await server.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    // health still works and reports the proxy
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.kodubProxy.path, "/kodub");
    assert.equal(health.kodubProxy.origin, ORIGIN);

    // HTTP GET with query string
    const res = await fetch(`${base}/kodub/v6/leaderboard?version=0.6.3&trackId=abc`, { headers: { Origin: "https://some-copy.github.io" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = await res.json();
    assert.equal(body.url, "/v6/leaderboard?version=0.6.3&trackId=abc");
    assert.equal(up.seen.http[0].origin, ORIGIN);

    // HTTP POST body
    const post = await (await fetch(`${base}/kodub/v6/user`, { method: "POST", body: "token=x", headers: { "Content-Type": "text/plain" } })).json();
    assert.equal(post.body, "token=x");

    // preflight
    const pre = await fetch(`${base}/kodub/v6/user`, { method: "OPTIONS", headers: { "Access-Control-Request-Headers": "content-type" } });
    assert.equal(pre.status, 204);

    // WebSocket upgrade relayed both ways
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/kodub/v6/multiplayer/host`, { headers: { Origin: "https://some-copy.github.io" } });
    const messages = [];
    await new Promise((resolve, reject) => {
      ws.on("message", (d) => {
        messages.push(d.toString());
        if (messages.length === 1) ws.send("ping");
        if (messages.length === 2) resolve();
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000).unref();
    });
    assert.equal(messages[0], JSON.stringify({ type: "hello-from-upstream" }));
    assert.equal(messages[1], "echo:ping");
    assert.equal(up.seen.ws[0].url, "/v6/multiplayer/host");
    assert.equal(up.seen.ws[0].origin, ORIGIN);
    ws.close();

    // the ranked websocket on the same port is unaffected
    const ranked = new WebSocket(`ws://127.0.0.1:${addr.port}`);
    await new Promise((resolve, reject) => {
      ranked.on("open", resolve);
      ranked.on("error", reject);
    });
    ranked.close();

    // a rejected upstream websocket is reported in /health
    const bad = await fakeUpstream("https://someone-else.example");
    const cfg2 = testConfig({ port: 0, host: "127.0.0.1", kodubProxy: { enabled: true, path: "/kodub", upstream: bad.url, origin: ORIGIN } });
    const server2 = createServer(cfg2, { log: { info() {}, warn() {}, error: console.error }, storePath: null });
    const addr2 = await server2.listen();
    try {
      const rejected = new WebSocket(`ws://127.0.0.1:${addr2.port}/kodub/v6/multiplayer/host`);
      await new Promise((resolve) => {
        rejected.on("error", resolve);
        rejected.on("close", resolve);
      });
      const h2 = await (await fetch(`http://127.0.0.1:${addr2.port}/health`)).json();
      assert.equal(h2.kodubProxy.wsRejected, 1);
      assert.match(h2.kodubProxy.lastError.error, /HTTP 403/);
    } finally {
      await server2.close();
      bad.wss.close();
      bad.srv.close();
    }
  } finally {
    await server.close();
    up.wss.close();
    up.srv.close();
  }
});

test("without the proxy, /kodub paths are plain 404s and websockets still work", async () => {
  const cfg = testConfig({ port: 0, host: "127.0.0.1" });
  const server = createServer(cfg, { log: { info() {}, warn() {}, error: console.error }, storePath: null });
  const addr = await server.listen();
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/kodub/v6/leaderboard`);
    assert.equal(res.status, 404);
    const health = await (await fetch(`http://127.0.0.1:${addr.port}/health`)).json();
    assert.equal(health.kodubProxy, null);
  } finally {
    await server.close();
  }
});
