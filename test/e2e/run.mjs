#!/usr/bin/env node
/**
 * End-to-end test: runs the real PolyTrack 0.6.3 PolyModLoader build in headless Chromium with the
 * PolyRanked mod loaded from this repository, against a local PolyRanked server, and plays a 1v1.
 *
 *   node test/e2e/run.mjs --game-dir /path/to/PolyModLoader [--headed] [--keep]
 *
 * The PolyModLoader checkout (https://github.com/polytrackmods/PolyModLoader) contains the game
 * files (main.bundle.js, tracks, ...). The CDN import of PolyTypes.js is served from that checkout
 * and all other external hosts (kodub.com, polymodloader.com) are blocked, so the test is offline.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "../../server/src/index.js";
import { deepMerge, DEFAULT_CONFIG } from "../../server/src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const argValue = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};
const gameDir = path.resolve(argValue("--game-dir", process.env.POLYTRACK_DIR ?? "/home/user/polytrackmods/polymodloader"));
const headed = args.includes("--headed");
const keep = args.includes("--keep");
const artifacts = path.join(root, "e2e-artifacts");
fs.mkdirSync(artifacts, { recursive: true });

if (!fs.existsSync(path.join(gameDir, "main.bundle.js"))) {
  console.error(`game directory ${gameDir} does not contain main.bundle.js`);
  process.exit(2);
}

const MIME = { ".js": "application/javascript", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".track": "text/plain", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".css": "text/css", ".jpg": "image/jpeg" };

function staticServer(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (url.pathname === "/" ) file = path.join(dir, "index.html");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, timeoutMs = 60000, interval = 250) {
  const start = Date.now();
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch (err) {
      v = undefined;
    }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(interval);
  }
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
}

const game = await staticServer(gameDir);
const serverCfg = deepMerge(DEFAULT_CONFIG, {
  port: 0,
  host: "127.0.0.1",
  serveModFrom: root,
  rounds: { countdownSeconds: 3, finishGraceSeconds: 3, resultsSeconds: 3, readyTimeoutSeconds: 60, disconnectGraceSeconds: 5, lateRecordGraceMs: 300 },
  matchmaking: { tickMs: 1000 },
  queues: { duel: { roundsToWin: 2, maxRounds: 3 } },
  rating: { placementMatches: 1 },
  requireVanillaPhysics: false,
  tracks: [{ id: "5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038", name: "Summer 1", trackUrl: "tracks/official/summer1.track", tier: 1, roundSeconds: 12 }],
});
const ranked = createServer(serverCfg, { log: { info: (...a) => console.log("[server]", ...a), warn: console.warn, error: console.error }, storePath: null });
const rankedAddr = await ranked.listen();
const wsUrl = `ws://127.0.0.1:${rankedAddr.port}`;
const modUrl = `http://127.0.0.1:${rankedAddr.port}/mod`;
const gameUrl = `http://127.0.0.1:${game.port}/index.html`;
console.log(`game: ${gameUrl}\nmod:  ${modUrl}\nws:   ${wsUrl}`);

const executablePath = process.env.CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  headless: !headed,
  executablePath,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage"],
});

const polyTypesSource = fs.readFileSync(path.join(gameDir, "PolyTypes.js"), "utf8");

async function openPlayer(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  await context.addInitScript(
    ({ modUrl, wsUrl, name }) => {
      localStorage.setItem("polyMods", JSON.stringify([{ base: modUrl, version: "latest", loaded: true }]));
      localStorage.setItem("polyranked.settings", JSON.stringify({ serverUrl: wsUrl, autoConnect: true, nameOverride: name, showHud: true }));
      if (!localStorage.getItem("polyranked.secret")) localStorage.setItem("polyranked.secret", Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""));
      window.alert = (m) => console.log("[alert]", m);
    },
    { modUrl, wsUrl, name },
  );
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js")) {
      return route.fulfill({ status: 200, contentType: "application/javascript", body: polyTypesSource });
    }
    if (/kodub\.com|polymodloader\.com/.test(url)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (text.includes("[PolyRanked]") || msg.type() === "error" || text.includes("[PML]")) console.log(`  (${name}) ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (err) => {
    logs.push(`[pageerror] ${err.message}`);
    console.log(`  (${name}) PAGE ERROR: ${err.message.slice(0, 300)}`);
  });
  await page.goto(gameUrl);
  return { name, page, context, logs };
}

const players = [];
let exitCode = 1;
try {
  players.push(await openPlayer("Alice"), await openPlayer("Bob"));

  for (const p of players) {
    await waitFor(`${p.name}: mod booted`, () => p.page.evaluate(() => !!globalThis.polyRanked), 180000, 500);
    check(`${p.name}: mod loaded and game bridge captured`, true);
    const problems = await p.page.evaluate(() => {
      const b = globalThis.__polyRankedBridge;
      return { startGame: typeof b?.startGame, args: b?.startGame?.length, determinism: b?.api?.determinismState ?? null, vanilla: globalThis.polyRanked.isVanilla() };
    });
    check(`${p.name}: bridge exposes startGame(6 args)`, problems.startGame === "function" && problems.args === 6, JSON.stringify(problems));
    await waitFor(`${p.name}: connected to ranked server`, () => p.page.evaluate(() => globalThis.polyRanked.client.state === "ready"), 60000);
    check(`${p.name}: signed in to the ranked server`, true);
    // A fresh profile starts in the tutorial; go to the main menu like a player would.
    const inMenu = await p.page.evaluate(() => {
      const app = globalThis.polyRanked;
      const inMenu = app.bridge.getState() instanceof app.bridge.getStateClasses().MainMenu;
      if (!inMenu) app.bridge.backToMenu(false, null);
      return inMenu;
    });
    if (!inMenu) await waitFor(`${p.name}: main menu`, () => p.page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu), 30000);
    check(`${p.name}: main menu reachable through the bridge`, true);
    await waitFor(`${p.name}: main menu button`, () => p.page.evaluate(() => !!document.querySelector(".polyranked-menu-button")), 120000, 500);
    check(`${p.name}: Ranked button injected into the main menu`, true);
    await p.page.screenshot({ path: path.join(artifacts, `${p.name}-menu.png`) });
  }

  // open the menu on Alice to check it renders, then close it
  await players[0].page.evaluate(() => globalThis.polyRanked.menu.open());
  const menuText = await players[0].page.evaluate(() => document.querySelector(".polyranked-ui")?.innerText ?? "");
  check("Alice: ranked menu shows queues", /Ranked 1v1/.test(menuText) && /Connected/.test(menuText), menuText.replace(/\s+/g, " ").slice(0, 140));
  await players[0].page.screenshot({ path: path.join(artifacts, "Alice-ranked-menu.png") });
  await players[0].page.evaluate(() => globalThis.polyRanked.menu.close());

  // queue both
  for (const p of players) await p.page.evaluate(() => globalThis.polyRanked.client.send({ type: "queue_join", queue: "duel" }));
  for (const p of players) {
    await waitFor(`${p.name}: in game`, () => p.page.evaluate(() => {
      const app = globalThis.polyRanked;
      return app.controller.connection && app.bridge.getState()?.multiplayerConnection === app.controller.connection;
    }), 90000, 250);
    await p.page.evaluate(() => (globalThis.__e2eState = globalThis.polyRanked.bridge.getState()));
    const info = await p.page.evaluate(() => {
      const app = globalThis.polyRanked;
      const classes = app.bridge.getStateClasses();
      const state = app.bridge.getState();
      const conn = app.controller.connection;
      return {
        inGame: state instanceof classes.InGame,
        sameConnection: state.multiplayerConnection === conn,
        callbacks: { carUpdate: conn.cb.carUpdate.length, endSession: conn.cb.endSession.length, newSession: conn.cb.newSession.length, playersChanged: conn.cb.playersChanged.length },
        players: conn.getPlayers().map((x) => ({ id: x.id, nickname: x.nickname, isSelf: x.isSelf })),
        round: app.controller.round,
        phase: app.controller.phase,
      };
    });
    check(`${p.name}: game entered the match state with our connection`, info.inGame && info.sameConnection, JSON.stringify(info));
    check(`${p.name}: game registered multiplayer callbacks`, info.callbacks.carUpdate === 1 && info.callbacks.endSession === 1 && info.callbacks.newSession === 1, JSON.stringify(info.callbacks));
    check(`${p.name}: both players visible to the game`, info.players.length === 2 && info.players.some((x) => x.isSelf) && info.players.some((x) => !x.isSelf), JSON.stringify(info.players));
  }
  await sleep(500);
  await players[0].page.screenshot({ path: path.join(artifacts, "Alice-countdown.png") });

  // wait for the race to start, then drive Alice's car
  await waitFor("racing", () => players[0].page.evaluate(() => globalThis.polyRanked.controller.phase === "racing"), 30000);
  const popupClosed = await players[0].page.evaluate(() => !globalThis.polyRanked.bridge.popups.isOpen);
  check("Alice: countdown popup closed at GO", popupClosed);
  await players[0].page.keyboard.down("ArrowUp");
  await sleep(2500);
  await players[0].page.keyboard.up("ArrowUp");
  await players[0].page.screenshot({ path: path.join(artifacts, "Alice-racing.png") });
  await players[1].page.screenshot({ path: path.join(artifacts, "Bob-racing.png") });
  const statsA = await players[0].page.evaluate(() => globalThis.polyRanked.controller.connection.stats);
  const statsB = await players[1].page.evaluate(() => globalThis.polyRanked.controller.connection.stats);
  check("Alice sent car states while driving", statsA.batchesSent > 0 && statsA.statesSent > 0, JSON.stringify(statsA));
  check("Bob received and applied Alice's car states", statsB.relaysReceived > 0 && statsB.statesApplied > 0, JSON.stringify(statsB));
  const remoteCar = await players[1].page.evaluate(() => {
    const app = globalThis.polyRanked;
    const state = app.bridge.getState();
    // the in-game state keeps remote cars in a private map; count rendered name tags instead
    return { hud: document.querySelector(".polyranked-hud")?.innerText?.replace(/\s+/g, " ") ?? "", stateOk: !!state };
  });
  check("Bob: HUD shows the match", /Ranked 1v1/.test(remoteCar.hud) && /Alice/.test(remoteCar.hud), remoteCar.hud.slice(0, 120));

  // Alice "finishes" round 1 by reporting a record through the game-facing connection
  const sid1 = await players[0].page.evaluate(() => globalThis.polyRanked.controller.sessionId);
  await players[0].page.evaluate((sid) => globalThis.polyRanked.controller.connection.sendRecord(sid, { numberOfFrames: 4321 }), sid1);
  const recA = await waitFor("records broadcast", () => players[1].page.evaluate(() => globalThis.polyRanked.hud.records), 10000);
  check("Bob sees Alice's record", Object.values(recA).includes(4321), JSON.stringify(recA));
  await waitFor("round 1 results", () => players[1].page.evaluate(() => globalThis.polyRanked.controller.phase === "results"), 30000);
  const results1 = await players[1].page.evaluate(() => ({ playerList: !!document.querySelector(".player-list-ui"), sessionEnd: !!document.querySelector(".session-end-ui"), text: document.querySelector(".player-list-ui")?.innerText?.replace(/\s+/g, " ") ?? "" }));
  check("Bob: game shows Session Results after round 1", results1.playerList && results1.sessionEnd, results1.text.slice(0, 120));
  await players[1].page.screenshot({ path: path.join(artifacts, "Bob-round1-results.png") });

  // round 2 restarts the game state through the new-session callback
  await waitFor("round 2", () => players[0].page.evaluate(() => globalThis.polyRanked.controller.round === 2 && ["countdown", "racing"].includes(globalThis.polyRanked.controller.phase)), 40000);
  const restarted = await players[0].page.evaluate(() => {
    const app = globalThis.polyRanked;
    const state = app.bridge.getState();
    return { newState: state !== globalThis.__e2eState, inGame: state instanceof app.bridge.getStateClasses().InGame, sameConnection: state.multiplayerConnection === app.controller.connection, callbacks: app.controller.connection.cb.endSession.length };
  });
  check("Alice: round 2 created a fresh game state on the same connection", restarted.newState && restarted.inGame && restarted.sameConnection && restarted.callbacks === 1, JSON.stringify(restarted));
  await waitFor("racing 2", () => players[0].page.evaluate(() => globalThis.polyRanked.controller.phase === "racing"), 30000);
  const sid2 = await players[0].page.evaluate(() => globalThis.polyRanked.controller.sessionId);
  check("session id changed between rounds", sid2 !== sid1, `${sid1} -> ${sid2}`);
  await sleep(3000); // a run cannot be longer than the time elapsed in the round
  await players[0].page.evaluate((sid) => globalThis.polyRanked.controller.connection.sendRecord(sid, { numberOfFrames: 2500 }), sid2);

  // match end
  const endA = await waitFor("match end", () => players[0].page.evaluate(() => globalThis.polyRanked.controller.matchEnd), 40000);
  check("match ended with Alice winning 2-0", endA.winner?.type === "team" && endA.reason === "rounds", JSON.stringify({ winner: endA.winner, reason: endA.reason, scores: endA.scores }));
  const overlay = await players[0].page.evaluate(() => document.querySelector(".polyranked-overlay:not(.hidden)")?.innerText?.replace(/\s+/g, " ") ?? "");
  check("Alice: match summary overlay with rating change", /VICTORY/.test(overlay) && /\+\d+/.test(overlay), overlay.slice(0, 160));
  const overlayB = await players[1].page.evaluate(() => document.querySelector(".polyranked-overlay:not(.hidden)")?.innerText?.replace(/\s+/g, " ") ?? "");
  check("Bob: match summary overlay shows defeat", /DEFEAT/.test(overlayB), overlayB.slice(0, 160));
  await players[0].page.screenshot({ path: path.join(artifacts, "Alice-match-end.png") });

  // back to the menu
  await players[0].page.click(".polyranked-overlay button:has-text('Back to menu')");
  await waitFor("main menu", () => players[0].page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu), 30000);
  const afterMenu = await players[0].page.evaluate(() => ({ button: !!document.querySelector(".polyranked-menu-button"), conn: globalThis.polyRanked.controller.connection, phase: globalThis.polyRanked.controller.phase, hudHidden: document.querySelector(".polyranked-hud")?.classList.contains("hidden") }));
  check("Alice: back in the main menu, controller idle", afterMenu.button && afterMenu.conn === null && afterMenu.phase === "idle" && afterMenu.hudHidden, JSON.stringify(afterMenu));
  await players[0].page.screenshot({ path: path.join(artifacts, "Alice-back-to-menu.png") });

  const lb = ranked.players.leaderboard("duel", 10);
  check("server leaderboard updated", lb.length === 2 && lb[0].nickname === "Alice", JSON.stringify(lb.map((e) => [e.nickname, e.rating])));

  // --- second match: "Queue again", then Bob quits through the game's own exit path -> forfeit
  await players[1].page.click(".polyranked-overlay button:has-text('Queue again')");
  await waitFor("Bob: main menu after queue again", () => players[1].page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu), 30000);
  const bobQueued = await waitFor("Bob queued", () => players[1].page.evaluate(() => !!globalThis.polyRanked.menu.queueStatus), 15000);
  check("Bob: 'Queue again' returned to the menu and queued", !!bobQueued);
  await players[0].page.evaluate(() => globalThis.polyRanked.client.send({ type: "queue_join", queue: "duel" }));
  for (const p of players) {
    await waitFor(`${p.name}: in match 2`, () => p.page.evaluate(() => {
      const app = globalThis.polyRanked;
      return app.controller.match && app.controller.match.matchId !== "m1" && app.controller.connection && app.bridge.getState()?.multiplayerConnection === app.controller.connection;
    }), 90000, 250);
  }
  check("second match started for both players", true);
  // Bob leaves the game state the way the Exit button does: the game disposes our connection.
  await players[1].page.evaluate(() => globalThis.polyRanked.bridge.backToMenu(false, null));
  const endA2 = await waitFor("match 2 end", () => players[0].page.evaluate(() => globalThis.polyRanked.controller.matchEnd), 30000);
  check("Alice wins match 2 by forfeit when Bob exits", endA2.reason === "forfeit" && endA2.winner?.type === "team", JSON.stringify({ reason: endA2.reason, winner: endA2.winner }));
  const bobAfter = await players[1].page.evaluate(() => ({ phase: globalThis.polyRanked.controller.phase, conn: globalThis.polyRanked.controller.connection, notice: globalThis.polyRanked.menu.notice?.text ?? "" }));
  check("Bob: controller idle after exiting, told about the forfeit", bobAfter.phase === "idle" && bobAfter.conn === null && /left the match/.test(bobAfter.notice), JSON.stringify(bobAfter));
  await players[0].page.click(".polyranked-overlay button:has-text('Back to menu')");
  await waitFor("Alice menu 2", () => players[0].page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu), 30000);
  const lb2 = ranked.players.leaderboard("duel", 10);
  check("leaderboard after two matches", lb2[0].nickname === "Alice" && lb2[0].wins === 2 && lb2[1].losses === 2, JSON.stringify(lb2.map((e) => [e.nickname, e.rating, e.wins, e.losses])));

  const errors = players.flatMap((p) => p.logs.filter((l) => l.startsWith("[pageerror]") || (l.startsWith("[error]") && /PolyRanked|polyranked/i.test(l))).map((l) => `${p.name}: ${l}`));
  check("no PolyRanked page errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));

  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error("E2E failed:", err);
  for (const p of players) {
    try {
      await p.page.screenshot({ path: path.join(artifacts, `${p.name}-failure.png`) });
    } catch {
      /* ignore */
    }
    fs.writeFileSync(path.join(artifacts, `${p.name}-console.log`), p.logs.join("\n"));
  }
  exitCode = 1;
} finally {
  for (const p of players) fs.writeFileSync(path.join(artifacts, `${p.name}-console.log`), p.logs.join("\n"));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; artifacts in ${path.relative(root, artifacts)}/`);
  if (!keep) {
    await browser.close();
    await ranked.close();
    game.srv.close();
  }
  process.exit(exitCode);
}
