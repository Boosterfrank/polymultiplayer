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
import path from "node:path";
import { createHarness, parseArgs } from "./harness.mjs";

const { gameDir, headed, keep } = parseArgs();
const harness = await createHarness({
  gameDir,
  headed,
  serverCfg: {
    rounds: { countdownSeconds: 3, finishGraceSeconds: 3, resultsSeconds: 3, readyTimeoutSeconds: 60, disconnectGraceSeconds: 5, lateRecordGraceMs: 300 },
    matchmaking: { tickMs: 1000 },
    queues: { duel: { roundsToWin: 2, maxRounds: 3 } },
    rating: { placementMatches: 1 },
    requireVanillaPhysics: false,
    cup: { enabled: false },
    tracks: [{ id: "5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038", name: "Summer 1", trackUrl: "tracks/official/summer1.track", tier: 1, roundSeconds: 12 }],
  },
});
const { artifacts, results, check, ranked, openPlayer, waitFor, sleep, players } = harness;

let exitCode = 1;
try {
  await openPlayer("Alice");
  await openPlayer("Bob");

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
  await harness.screenshotAll("failure");
  exitCode = 1;
} finally {
  process.exit(await harness.finish(exitCode, { keep }));
}
