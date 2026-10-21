import http from "node:http";
import https from "node:https";
import { WebSocketServer, WebSocket } from "ws";

/**
 * Opt-in reverse proxy for PolyTrack's official backend (leaderboards, multiplayer signaling).
 *
 * PolyTrack's servers only answer requests whose `Origin` header belongs to a known host, so a
 * self-hosted game copy cannot create multiplayer invites or load leaderboards on its own.
 * With this proxy enabled, the game copy (built with POLYRANKED_KODUB_PROXY=<this server>/kodub)
 * sends those requests here instead, and they are forwarded with the configured `Origin`.
 *
 * Routes: `<path>/<rest>` -> `<upstream>/<rest>` for HTTP(S) requests and WebSocket upgrades.
 */
export function createKodubProxy(cfg, { log = console } = {}) {
  const prefix = (cfg.path ?? "/kodub").replace(/\/+$/, "");
  const upstream = new URL(cfg.upstream ?? "https://vps.kodub.com");
  const origin = cfg.origin ?? "https://app-polytrack-desktop.polymodloader.com";
  const wss = new WebSocketServer({ noServer: true });
  const stats = { httpRequests: 0, httpErrors: 0, wsConnections: 0, wsRejected: 0, lastError: null };
  const note = (err) => {
    stats.lastError = { at: new Date().toISOString(), error: err };
    log.warn?.("[kodub-proxy]", err);
  };

  const matches = (url) => url === prefix || url.startsWith(prefix + "/") || url.startsWith(prefix + "?");

  function upstreamUrl(reqUrl) {
    const rest = reqUrl.slice(prefix.length).replace(/^\/+/, "");
    return new URL(rest, upstream.href.endsWith("/") ? upstream.href : upstream.href + "/");
  }

  function forwardHeaders(req) {
    const headers = {};
    for (const name of ["content-type", "accept", "accept-language", "user-agent", "range"]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    headers.origin = origin;
    headers.referer = origin + "/";
    return headers;
  }

  /** @returns {boolean} whether the request was handled */
  function handleHttp(req, res) {
    if (!matches(req.url)) return false;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }
    const target = upstreamUrl(req.url);
    const client = target.protocol === "https:" ? https : http;
    stats.httpRequests++;
    const proxied = client.request(target, { method: req.method, headers: forwardHeaders(req), timeout: 30000 }, (up) => {
      if ((up.statusCode ?? 500) >= 400) {
        stats.httpErrors++;
        note(`upstream answered ${up.statusCode} for ${req.method} ${target.pathname}`);
      }
      const headers = {};
      for (const name of ["content-type", "content-length", "cache-control", "content-encoding"]) {
        if (up.headers[name]) headers[name] = up.headers[name];
      }
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    });
    proxied.on("timeout", () => proxied.destroy(new Error("upstream timeout")));
    proxied.on("error", (err) => {
      stats.httpErrors++;
      note(`upstream request failed: ${err.message}`);
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("upstream error");
    });
    req.pipe(proxied);
    return true;
  }

  /** @returns {boolean} whether the upgrade was handled */
  function handleUpgrade(req, socket, head) {
    if (!matches(req.url)) return false;
    const target = upstreamUrl(req.url);
    target.protocol = target.protocol === "http:" ? "ws:" : "wss:";
    stats.wsConnections++;
    const up = new WebSocket(target, { headers: { Origin: origin }, handshakeTimeout: 15000 });
    let client = null;
    const pending = [];
    up.on("unexpected-response", (_req, res) => {
      stats.wsRejected++;
      note(`upstream rejected websocket ${target.pathname} with HTTP ${res.statusCode} (origin ${origin})`);
      res.resume();
      socket.destroy();
    });
    up.on("open", () => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        client = ws;
        for (const [data, isBinary] of pending) ws.send(data, { binary: isBinary });
        pending.length = 0;
        ws.on("message", (data, isBinary) => {
          if (up.readyState === WebSocket.OPEN) up.send(data, { binary: isBinary });
        });
        ws.on("close", (code, reason) => closeUpstream(code, reason));
        ws.on("error", () => closeUpstream(1011, "client error"));
      });
    });
    up.on("message", (data, isBinary) => {
      if (client && client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      else pending.push([data, isBinary]);
    });
    up.on("close", (code, reason) => {
      if (client) closeClient(code, reason);
      else socket.destroy();
    });
    up.on("error", (err) => {
      if (!client) stats.wsRejected++;
      note(`upstream websocket error: ${err.message}`);
      if (client) closeClient(1011, "upstream error");
      else socket.destroy();
    });
    const safeCode = (code) => (code === 1005 || code === 1006 || code < 1000 || code > 4999 ? 1000 : code);
    function closeUpstream(code, reason) {
      if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) {
        try {
          up.close(safeCode(code), reason?.toString?.().slice(0, 120) ?? "");
        } catch {
          up.terminate();
        }
      }
    }
    function closeClient(code, reason) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.close(safeCode(code), reason?.toString?.().slice(0, 120) ?? "");
        } catch {
          client.terminate();
        }
      }
    }
    return true;
  }

  return { prefix, upstream: upstream.href, origin, stats, handleHttp, handleUpgrade, close: () => wss.close() };
}
