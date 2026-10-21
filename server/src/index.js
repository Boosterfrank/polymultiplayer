import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { MSG, PROTOCOL_VERSION, BIN } from "../../shared/protocol.js";
import { loadConfig } from "./config.js";
import { JsonStore } from "./store.js";
import { PlayerRegistry, sanitizeNickname } from "./players.js";
import { Matchmaker } from "./matchmaking.js";
import { Match, PHASE } from "./match.js";
import { buildPool, pickTrack } from "./tracks.js";
import { divisionFor } from "./rating.js";
import { createKodubProxy } from "./kodubproxy.js";

const MIME = {
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const MAX_JSON_BYTES = 16 * 1024;
const MAX_BIN_BYTES = 64 * 1024;
const MAX_BIN_PER_SECOND = 60;

/**
 * Create (but do not start) the PolyRanked server.
 * @returns {{cfg, httpServer, wss, store, players, matchmaker, matches, listen(), close()}}
 */
export function createServer(cfg, { log = console, storePath } = {}) {
  const store = new JsonStore(storePath === undefined ? path.join(cfg.dataDir, "polyranked.json") : storePath, { log });
  store.load();
  const players = new PlayerRegistry(store, cfg.rating);
  const matchmaker = new Matchmaker(cfg.queues, cfg.matchmaking);
  const pool = buildPool(cfg.tracks, { roundSeconds: cfg.rounds.defaultRoundSeconds });
  const queueIds = Object.keys(cfg.queues);

  /** @type {Map<string, Match>} */
  const matches = new Map();
  /** @type {Map<string, string>} playerId -> matchId */
  const playerMatch = new Map();
  /** @type {Map<string, Conn>} playerId -> connection */
  const connections = new Map();
  const recentTrackIds = [];

  // ------------------------------------------------------------------ HTTP

  const kodubProxy = cfg.kodubProxy?.enabled ? createKodubProxy(cfg.kodubProxy, { log }) : null;

  const httpServer = http.createServer((req, res) => {
    if (kodubProxy && kodubProxy.handleHttp(req, res)) return;
    const url = new URL(req.url, "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === "/" || url.pathname === "/health") {
      return json(res, 200, { ok: true, name: "polyranked", protocol: PROTOCOL_VERSION, online: connections.size, matches: matches.size, queues: queueIds.map((q) => matchmaker.status(q)), kodubProxy: kodubProxy ? kodubProxy.prefix : null });
    }
    if (url.pathname === "/api/queues") {
      return json(res, 200, { queues: queueInfo() });
    }
    if (url.pathname === "/api/leaderboard") {
      const queue = url.searchParams.get("queue") ?? queueIds[0];
      if (!cfg.queues[queue]) return json(res, 404, { error: "unknown queue" });
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      return json(res, 200, { queue, entries: players.leaderboard(queue, limit) });
    }
    if (url.pathname === "/api/stats") {
      return json(res, 200, { players: Object.keys(store.data.players).length, matchesPlayed: store.data.meta.matchCounter ?? 0, recentMatches: store.data.matches.slice(-20) });
    }
    if (cfg.serveModFrom && (url.pathname === "/mod" || url.pathname.startsWith("/mod/"))) {
      return serveStatic(res, cfg.serveModFrom, url.pathname.replace(/^\/mod\/?/, ""));
    }
    json(res, 404, { error: "not found" });
  });

  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }

  function serveStatic(res, root, rel) {
    const base = path.resolve(root);
    const file = path.resolve(base, rel || "index.html");
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  }

  function queueInfo() {
    return queueIds.map((id) => {
      const q = cfg.queues[id];
      return {
        id,
        name: q.name,
        scoring: q.scoring,
        players: Matchmaker.requiredPlayers(q),
        teams: q.teams ?? null,
        teamSize: q.teamSize ?? null,
        roundsToWin: q.roundsToWin ?? null,
        maxRounds: q.maxRounds,
        waiting: matchmaker.status(id).waiting,
      };
    });
  }

  // ------------------------------------------------------------------ WebSocket

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BIN_BYTES });
  httpServer.on("upgrade", (req, socket, head) => {
    if (kodubProxy && kodubProxy.handleUpgrade(req, socket, head)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  class Conn {
    constructor(ws) {
      this.ws = ws;
      this.playerId = null;
      this.player = null;
      this.canQueue = false;
      this.queueReason = null;
      this.alive = true;
      this.pingMs = null;
      this.lastPingSent = 0;
      this.joinedQueueAt = 0;
      this.binWindowStart = 0;
      this.binCount = 0;
    }
    /** Simple per-second limiter for binary frames (the mod sends ~10 batches per second). */
    allowBinary(now = Date.now()) {
      if (now - this.binWindowStart >= 1000) {
        this.binWindowStart = now;
        this.binCount = 0;
      }
      return ++this.binCount <= MAX_BIN_PER_SECOND;
    }
    send(obj) {
      if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(obj));
    }
    sendBinary(bytes) {
      if (this.ws.readyState === this.ws.OPEN) this.ws.send(bytes, { binary: true });
    }
    error(code, message) {
      this.send({ type: MSG.ERROR, code, message });
    }
  }

  wss.on("connection", (ws, req) => {
    if (wss.clients.size > cfg.maxConnections) {
      ws.close(1013, "server full");
      return;
    }
    const conn = new Conn(ws);
    log.info?.(`[ws] connection from ${req.socket.remoteAddress}`);
    ws.on("pong", () => {
      conn.alive = true;
      if (conn.lastPingSent) conn.pingMs = Date.now() - conn.lastPingSent;
    });
    ws.on("message", (data, isBinary) => {
      try {
        if (isBinary) onBinary(conn, data);
        else onMessage(conn, data);
      } catch (err) {
        log.error("[ws] message error", err);
        conn.error("internal", "internal error");
      }
    });
    ws.on("close", () => onClose(conn));
    ws.on("error", (err) => log.warn?.("[ws] socket error", err?.message));
  });

  function onBinary(conn, data) {
    if (!conn.playerId) return;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length === 0 || bytes.length > MAX_BIN_BYTES) return;
    if (bytes[0] !== BIN.CAR_UPDATE) return;
    if (!conn.allowBinary()) return;
    const match = matchOf(conn.playerId);
    match?.carBatch(conn.playerId, bytes);
  }

  function matchOf(playerId) {
    const id = playerMatch.get(playerId);
    return id ? matches.get(id) ?? null : null;
  }

  function onMessage(conn, data) {
    if (data.length > MAX_JSON_BYTES) return conn.error("too_large", "message too large");
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return conn.error("bad_json", "invalid JSON");
    }
    if (!msg || typeof msg.type !== "string") return conn.error("bad_message", "missing type");

    if (msg.type === MSG.PING) {
      return conn.send({ type: MSG.PONG, t: msg.t ?? null, serverTime: Date.now() });
    }
    if (msg.type === MSG.HELLO) return onHello(conn, msg);
    if (!conn.playerId) return conn.error("not_authenticated", "send hello first");

    switch (msg.type) {
      case MSG.QUEUE_JOIN:
        return onQueueJoin(conn, msg);
      case MSG.QUEUE_LEAVE:
        if (matchmaker.leave(conn.playerId)) conn.send({ type: MSG.QUEUE_STATUS, queueId: null, waiting: 0, required: 0, waitedMs: 0, inQueue: false });
        return;
      case MSG.MATCH_READY:
        return matchOf(conn.playerId)?.ready(conn.playerId);
      case MSG.RECORD:
        return matchOf(conn.playerId)?.record(conn.playerId, Number(msg.sessionId), Number(msg.frames));
      case MSG.CAR_RESET:
        return matchOf(conn.playerId)?.carReset(conn.playerId, Number(msg.sessionId), Number(msg.resetCounter));
      case MSG.LEAVE_MATCH: {
        const match = matchOf(conn.playerId);
        if (match) match.leave(conn.playerId);
        return;
      }
      case MSG.LEADERBOARD_GET: {
        const queue = cfg.queues[msg.queue] ? msg.queue : queueIds[0];
        return conn.send({ type: MSG.LEADERBOARD, queue, entries: players.leaderboard(queue, 50) });
      }
      default:
        return conn.error("unknown_type", `unknown message type ${msg.type}`);
    }
  }

  function onHello(conn, msg) {
    if (typeof msg.secret !== "string" || msg.secret.length < 16 || msg.secret.length > 128) {
      return conn.error("bad_secret", "invalid secret");
    }
    if (msg.protocol !== PROTOCOL_VERSION) {
      conn.error("protocol_mismatch", `server speaks protocol ${PROTOCOL_VERSION}`);
      return conn.ws.close(1008, "protocol mismatch");
    }
    const id = PlayerRegistry.idFromSecret(msg.secret);
    const existing = connections.get(id);
    if (existing && existing !== conn) {
      existing.error("replaced", "another connection signed in with this identity");
      existing.playerId = null; // prevent onClose from touching the queue/match
      existing.ws.close(4001, "replaced");
      connections.delete(id);
    }
    const player = players.getOrCreate(id, { nickname: msg.nickname, countryCode: msg.countryCode, carStyle: msg.carStyle });
    conn.playerId = id;
    conn.player = player;
    connections.set(id, conn);

    conn.canQueue = true;
    conn.queueReason = null;
    if (cfg.gameVersion && msg.gameVersion !== cfg.gameVersion) {
      conn.canQueue = false;
      conn.queueReason = `This server requires PolyTrack ${cfg.gameVersion}`;
    } else if (cfg.requireVanillaPhysics && msg.vanilla === false) {
      conn.canQueue = false;
      conn.queueReason = "Disable mods that change the physics to play ranked";
    }

    conn.send({
      type: MSG.WELCOME,
      playerId: id,
      serverTime: Date.now(),
      protocol: PROTOCOL_VERSION,
      canQueue: conn.canQueue,
      queueReason: conn.queueReason,
      profile: players.publicProfile(id, queueIds),
      queues: queueInfo(),
      rating: { initial: cfg.rating.initial, placementMatches: cfg.rating.placementMatches, divisions: cfg.rating.divisions.map((d) => ({ name: d.name, min: Number.isFinite(d.min) ? d.min : null, tier: d.tier })) },
    });

    // Resume a match we were disconnected from.
    const match = matchOf(id);
    if (match && match.phase !== PHASE.FINISHED) {
      match.reconnected(id);
    } else if (match) {
      playerMatch.delete(id);
    }
  }

  function onQueueJoin(conn, msg) {
    const queueId = String(msg.queue ?? "");
    if (!cfg.queues[queueId]) return conn.error("unknown_queue", "unknown queue");
    if (!conn.canQueue) return conn.error("cannot_queue", conn.queueReason ?? "cannot queue");
    if (cfg.requireVanillaPhysics && msg.vanilla === false) return conn.error("cannot_queue", "Disable mods that change the physics to play ranked");
    const current = matchOf(conn.playerId);
    if (current && current.phase !== PHASE.FINISHED) return conn.error("in_match", "you are already in a match");
    if (current) playerMatch.delete(conn.playerId);
    const entry = players.ratingEntry(conn.playerId, queueId);
    matchmaker.leave(conn.playerId);
    matchmaker.join(conn.playerId, queueId, entry.rating);
    conn.joinedQueueAt = Date.now();
    sendQueueStatus(conn);
  }

  function sendQueueStatus(conn) {
    const queueId = matchmaker.queueOf(conn.playerId);
    if (!queueId) return;
    const s = matchmaker.status(queueId);
    conn.send({ type: MSG.QUEUE_STATUS, queueId, waiting: s.waiting, required: s.required, waitedMs: Date.now() - conn.joinedQueueAt, inQueue: true });
  }

  function onClose(conn) {
    if (!conn.playerId) return;
    if (connections.get(conn.playerId) === conn) connections.delete(conn.playerId);
    matchmaker.leave(conn.playerId);
    matchOf(conn.playerId)?.disconnected(conn.playerId);
  }

  // ------------------------------------------------------------------ matches

  const io = {
    send(playerId, msg) {
      connections.get(playerId)?.send(msg);
    },
    sendBinary(playerId, bytes) {
      connections.get(playerId)?.sendBinary(bytes);
    },
    getPing(playerId) {
      return connections.get(playerId)?.pingMs ?? null;
    },
    onFinished(match, summary) {
      for (const r of summary.ratings) {
        players.applyResult(r.id, match.queueId, r.delta, r.result);
      }
      players.recordMatch(summary);
      log.info?.(`[match ${match.id}] finished: ${summary.reason}`);
      // Keep the finished match around briefly so late messages are ignored gracefully.
      setTimeout(() => {
        matches.delete(match.id);
        for (const p of match.players) if (playerMatch.get(p.id) === match.id) playerMatch.delete(p.id);
        match.destroy();
      }, 5000).unref?.();
    },
  };

  function createMatch(queueId, formed) {
    const queue = cfg.queues[queueId];
    const seq = players.nextMatchSeq();
    const matchPlayers = formed.map((f) => {
      const p = players.get(f.playerId);
      const entry = players.ratingEntry(f.playerId, queueId);
      return {
        id: f.playerId,
        nickname: p?.nickname ?? "Anonymous",
        countryCode: p?.countryCode ?? null,
        carStyle: p?.carStyle ?? null,
        team: f.team,
        rating: entry.rating,
        matches: entry.matches,
      };
    });
    let maxTier = Infinity;
    for (const p of matchPlayers) maxTier = Math.min(maxTier, divisionFor(p.rating, p.matches, cfg.rating).tier);
    const track = pickTrack(pool, Number.isFinite(maxTier) ? maxTier : 1, recentTrackIds);
    if (!track) {
      log.error("[match] no tracks configured");
      for (const p of matchPlayers) connections.get(p.id)?.error("no_tracks", "server has no tracks configured");
      return;
    }
    recentTrackIds.push(track.id);
    if (recentTrackIds.length > 4) recentTrackIds.shift();
    const match = new Match({ id: `m${seq}`, seq, queueId, queue, cfg, players: matchPlayers, track, pool, io, log });
    matches.set(match.id, match);
    for (const p of matchPlayers) playerMatch.set(p.id, match.id);
    log.info?.(`[match ${match.id}] ${queueId} on ${track.name}: ${matchPlayers.map((p) => p.nickname).join(", ")}`);
    match.start();
  }

  let tickTimer = null;
  let heartbeatTimer = null;
  let pingsTimer = null;

  function tick() {
    const formed = matchmaker.tick(Date.now());
    for (const f of formed) createMatch(f.queueId, f.players);
    for (const conn of connections.values()) if (matchmaker.has(conn.playerId)) sendQueueStatus(conn);
  }

  function heartbeat() {
    for (const ws of wss.clients) {
      const conn = [...connections.values()].find((c) => c.ws === ws);
      if (conn && !conn.alive) {
        ws.terminate();
        continue;
      }
      if (conn) {
        conn.alive = false;
        conn.lastPingSent = Date.now();
      }
      ws.ping();
    }
  }

  function broadcastPings() {
    for (const match of matches.values()) {
      if (match.phase === PHASE.FINISHED) continue;
      const msg = match.pingsMessage();
      match.broadcast(msg);
    }
  }

  return {
    cfg,
    httpServer,
    wss,
    store,
    players,
    matchmaker,
    matches,
    connections,
    tick,
    listen() {
      return new Promise((resolve) => {
        httpServer.listen(cfg.port, cfg.host, () => {
          tickTimer = setInterval(tick, cfg.matchmaking.tickMs);
          heartbeatTimer = setInterval(heartbeat, 15000);
          pingsTimer = setInterval(broadcastPings, 3000);
          resolve(httpServer.address());
        });
      });
    },
    close() {
      clearInterval(tickTimer);
      clearInterval(heartbeatTimer);
      clearInterval(pingsTimer);
      for (const m of matches.values()) m.destroy();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      kodubProxy?.close();
      store.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------- CLI

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const cfg = loadConfig();
  const server = createServer(cfg);
  server.listen().then((addr) => {
    console.log(`[polyranked] listening on ws://${addr.address}:${addr.port}  (queues: ${Object.keys(cfg.queues).join(", ")}, tracks: ${cfg.tracks.length})`);
    if (cfg.serveModFrom) console.log(`[polyranked] serving mod files from ${path.resolve(cfg.serveModFrom)} at http://localhost:${addr.port}/mod/`);
    if (cfg.kodubProxy?.enabled) console.log(`[polyranked] proxying PolyTrack's backend at http://localhost:${addr.port}${cfg.kodubProxy.path} (origin ${cfg.kodubProxy.origin})`);
  });
  const shutdown = () => {
    console.log("[polyranked] shutting down");
    server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { sanitizeNickname };
