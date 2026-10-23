#!/usr/bin/env node
/**
 * End-to-end test of the always-on Quickplay Cup: two players join from the game's multiplayer
 * page, race two rounds on two tracks, one wins the cup, the next cup starts by itself, one
 * player quits through the game's Exit path, the other leaves from the lobby.
 *
 *   node test/e2e/cup.mjs --game-dir /path/to/PolyModLoader [--headed] [--keep]
 */
import path from "node:path";
import { createHarness, parseArgs } from "./harness.mjs";

const { gameDir, headed, keep } = parseArgs();
const TRACKS = [
  { id: "5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038", name: "Summer 1", trackUrl: "tracks/official/summer1.track", tier: 1, roundSeconds: 12 },
  { id: "7eac4fee1111152cfba4d3737410264ca0f22c7f5a2211e79f0099589b8b48c0", name: "Summer 2", trackUrl: "tracks/official/summer2.track", tier: 1, roundSeconds: 12 },
];
const harness = await createHarness({
  gameDir,
  headed,
  serverCfg: {
    rounds: { countdownSeconds: 3, finishGraceSeconds: 3, resultsSeconds: 3, readyTimeoutSeconds: 60, disconnectGraceSeconds: 5, lateRecordGraceMs: 300 },
    requireVanillaPhysics: false,
    cup: { enabled: true, name: "Quickplay Cup", minPlayers: 2, maxPlayers: 8, roundsPerTrack: 1, target: 18, pointsTable: [10, 8], waitSeconds: 2, breakSeconds: 4, idleResetSeconds: 30 },
    tracks: TRACKS,
  },
});
const { artifacts, results, check, ranked, httpUrl, openPlayer, readyPlayer, waitFor, sleep, players } = harness;

const cupState = () => ranked.cup.publicState();
const MP_BUTTON = 'button.button-image:has(img[src="images/multiplayer.svg"])';
const openMultiplayerPage = async (p) => {
  // the game reveals its menu buttons with a delayed animation; wait for it, then click like a player
  await waitFor(`${p.name}: main menu buttons revealed`, () => p.page.evaluate(() => {
    const b = document.querySelector('button.button-image img[src="images/multiplayer.svg"]')?.closest("button");
    if (!b) return false;
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.width > 0 && getComputedStyle(b).opacity !== "0" && (hit === b || b.contains(hit));
  }), 60000, 300);
  await p.page.click(MP_BUTTON);
  await waitFor(`${p.name}: cup box on the multiplayer page`, () => p.page.evaluate(() => !!document.querySelector(".multiplayer-ui > .join .polyranked-cup .pr-cup-join")), 20000);
};
const boxStatus = (p) => p.page.evaluate(() => document.querySelector(".polyranked-cup .pr-cup-status")?.textContent ?? "");
const clickCupButton = (p) => p.page.evaluate(() => document.querySelector(".polyranked-cup .pr-cup-join").click());
const inGame = (p) =>
  p.page.evaluate(() => {
    const app = globalThis.polyRanked;
    return !!app.controller.connection && app.bridge.getState() instanceof app.bridge.getStateClasses().InGame && app.bridge.getState().multiplayerConnection === app.controller.connection;
  });

let exitCode = 1;
try {
  const alice = await openPlayer("Alice");
  const bob = await openPlayer("Bob");
  for (const p of players) await readyPlayer(p);
  check("both players booted, signed in and in the main menu", true);
  check("welcome announces the cup", await alice.page.evaluate(() => globalThis.polyRanked.client.welcome?.cup?.enabled === true && globalThis.polyRanked.client.welcome.cup.phase === "idle"));

  // ------------------------------------------------------------ Alice joins from the multiplayer page
  await openMultiplayerPage(alice);
  const emptyStatus = await waitFor("Alice: cup status fetched", async () => {
    const t = await boxStatus(alice);
    return /nobody racing/.test(t) ? t : null;
  }, 15000, 300);
  check("Alice: the multiplayer page shows the Join the Cup box with the live state", /Always on/.test(emptyStatus) && /first to 18/.test(emptyStatus), emptyStatus);
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-box.png") });
  // a real click on the big button (not a DOM click) must reach it
  const hit = await alice.page.evaluate(() => {
    const b = document.querySelector(".polyranked-cup .pr-cup-join");
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === b || b.contains(el);
  });
  check("Alice: the Join the Cup button is on top and clickable", hit);
  await alice.page.click(".polyranked-cup .pr-cup-join");
  await waitFor("Alice: in the cup", () => alice.page.evaluate(() => !!globalThis.polyRanked.controller.cup), 15000);
  const lobby = await waitFor("Alice: lobby overlay", () => alice.page.evaluate(() => document.querySelector(".polyranked-overlay:not(.hidden) .pr-lobby")?.innerText?.replace(/\s+/g, " ") ?? null), 10000);
  check("Alice: lobby overlay says she is in and waiting for racers", /You are in/.test(lobby) && /1\/2 racers/.test(lobby), lobby.slice(0, 140));
  check("server: Alice is the first member, lobby idle", ranked.cup.members.size === 1 && cupState().phase === "idle");
  const joinedStatus = await waitFor("Alice: box reflects membership", async () => {
    const t = await boxStatus(alice);
    return /You are in the cup/.test(t) ? t : null;
  }, 5000, 200);
  check("Alice: the box turns into 'Leave the cup' while she is in", /You are in the cup/.test(joinedStatus) && (await alice.page.evaluate(() => document.querySelector(".pr-cup-join")?.textContent?.includes("Leave the cup"))));
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-lobby.png") });

  // ------------------------------------------------------------ Bob joins: the cup starts
  await openMultiplayerPage(bob);
  const waitingStatus = await waitFor("Bob: sees Alice waiting", async () => {
    const t = await boxStatus(bob);
    return /1 waiting/.test(t) ? t : null;
  }, 15000, 300);
  check("Bob: the box shows one racer waiting", /2 needed/.test(waitingStatus), waitingStatus);
  await clickCupButton(bob);
  for (const p of players) await waitFor(`${p.name}: round 1 started the game`, () => inGame(p), 40000, 250);
  check("both players are in the game with the cup connection", true);
  const round1 = await alice.page.evaluate(() => ({ round: globalThis.polyRanked.controller.round, cupNumber: globalThis.polyRanked.controller.cup?.cupNumber, hud: document.querySelector(".polyranked-hud")?.innerText?.replace(/\s+/g, " ") ?? "", overlayHidden: document.querySelector(".polyranked-overlay")?.classList.contains("hidden"), players: globalThis.polyRanked.controller.connection.getPlayers().length }));
  check("Alice: round 1 of cup #1, HUD shows the cup format, lobby overlay closed", round1.round === 1 && round1.cupNumber === 1 && /Quickplay Cup/.test(round1.hud) && /first to 18/.test(round1.hud) && round1.overlayHidden && round1.players === 2, JSON.stringify(round1));
  const track1 = await alice.page.evaluate(() => globalThis.polyRanked.controller.match.track.id);
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-round1.png") });

  // round 1: only Alice finishes
  await waitFor("racing 1", () => alice.page.evaluate(() => globalThis.polyRanked.controller.phase === "racing"), 20000);
  await sleep(3500);
  await alice.page.evaluate(() => globalThis.polyRanked.controller.connection.sendRecord(globalThis.polyRanked.controller.sessionId, { numberOfFrames: 3000 }));
  await waitFor("round 1 results", () => bob.page.evaluate(() => globalThis.polyRanked.controller.phase === "results"), 30000);
  const scores1 = await bob.page.evaluate(() => globalThis.polyRanked.hud.scores?.points ?? null);
  check("round 1: Alice 10 points, Bob (did not finish) 0", scores1 && Object.values(scores1).sort().join(",") === "0,10", JSON.stringify(scores1));

  // round 2 switches track (roundsPerTrack = 1) and restarts the game
  await waitFor("round 2", () => alice.page.evaluate(() => globalThis.polyRanked.controller.round === 2 && ["countdown", "racing"].includes(globalThis.polyRanked.controller.phase)), 30000);
  const track2 = await alice.page.evaluate(() => globalThis.polyRanked.controller.match.track.id);
  check("round 2 is raced on the other track", track2 !== track1 && TRACKS.some((t) => t.id === track2), `${track1.slice(0, 8)} -> ${track2.slice(0, 8)}`);
  for (const p of players) await waitFor(`${p.name}: game restarted for round 2`, () => inGame(p), 20000, 250);
  check("the game restarted on the new track for both players", true);
  await waitFor("racing 2", () => alice.page.evaluate(() => globalThis.polyRanked.controller.phase === "racing"), 20000);
  await sleep(3500);
  await alice.page.evaluate(() => globalThis.polyRanked.controller.connection.sendRecord(globalThis.polyRanked.controller.sessionId, { numberOfFrames: 2600 }));
  await bob.page.evaluate(() => globalThis.polyRanked.controller.connection.sendRecord(globalThis.polyRanked.controller.sessionId, { numberOfFrames: 3200 }));

  // cup over: Alice 20 >= 18
  for (const p of players) await waitFor(`${p.name}: cup over`, () => p.page.evaluate(() => globalThis.polyRanked.controller.phase === "cupBreak"), 30000);
  const overlayA = await alice.page.evaluate(() => document.querySelector(".polyranked-overlay:not(.hidden)")?.innerText?.replace(/\s+/g, " ") ?? "");
  const overlayB = await bob.page.evaluate(() => document.querySelector(".polyranked-overlay:not(.hidden)")?.innerText?.replace(/\s+/g, " ") ?? "");
  check("Alice: cup-over overlay with the win and the standings", /YOU WIN THE CUP/.test(overlayA) && /Alice/.test(overlayA) && /20 pts/.test(overlayA) && /Bob/.test(overlayA) && /8 pts/.test(overlayA) && /Next cup starts in/.test(overlayA), overlayA.slice(0, 200));
  check("Bob: cup-over overlay names the winner", /Alice wins the cup/.test(overlayB), overlayB.slice(0, 120));
  check("server: cup #1 completed, winner recorded for the cup leaderboard", ranked.cup.cupsCompleted === 1 && ranked.players.cupLeaderboard(5)[0]?.nickname === "Alice" && ranked.players.cupLeaderboard(5)[0]?.wins === 1, JSON.stringify(ranked.players.cupLeaderboard(5)));
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-over.png") });

  // the next cup starts by itself after the break
  await waitFor("cup #2 round 1", () => alice.page.evaluate(() => globalThis.polyRanked.controller.cup?.cupNumber === 2 && globalThis.polyRanked.controller.round === 1 && ["countdown", "racing"].includes(globalThis.polyRanked.controller.phase)), 30000);
  for (const p of players) await waitFor(`${p.name}: in game for cup #2`, () => inGame(p), 20000, 250);
  const cup2 = await alice.page.evaluate(() => ({ points: globalThis.polyRanked.hud.scores?.points, overlayHidden: document.querySelector(".polyranked-overlay")?.classList.contains("hidden") }));
  check("cup #2 started automatically with the standings reset", cup2.overlayHidden && Object.values(cup2.points ?? { x: 1 }).every((v) => v === 0), JSON.stringify(cup2));

  // Bob quits through the game's Exit path; Alice ends up waiting for racers
  await bob.page.evaluate(() => globalThis.polyRanked.bridge.backToMenu(false, null));
  await waitFor("server: Bob removed", () => ranked.cup.members.size === 1, 10000, 200);
  const bobAfter = await bob.page.evaluate(() => ({ phase: globalThis.polyRanked.controller.phase, cup: globalThis.polyRanked.controller.cup, notice: globalThis.polyRanked.menu.notice?.text ?? "" }));
  check("Bob: controller idle after exiting, told he left the cup", bobAfter.phase === "idle" && bobAfter.cup === null && /left the cup/.test(bobAfter.notice), JSON.stringify(bobAfter));
  await waitFor("racing (cup 2)", () => alice.page.evaluate(() => globalThis.polyRanked.controller.phase === "racing"), 20000);
  await sleep(3500);
  await alice.page.evaluate(() => globalThis.polyRanked.controller.connection.sendRecord(globalThis.polyRanked.controller.sessionId, { numberOfFrames: 3000 }));
  await waitFor("server: cup idle with Alice alone", () => ranked.cup.phase === "idle" && ranked.cup.members.size === 1, 30000, 200);
  const aliceAlone = await alice.page.evaluate(() => ({ players: globalThis.polyRanked.controller.match?.players?.length, hud: document.querySelector(".polyranked-hud")?.innerText?.replace(/\s+/g, " ") ?? "", active: globalThis.polyRanked.controller.active }));
  check("Alice: still in the cup, HUD waits for racers", aliceAlone.active && aliceAlone.players === 1 && /Waiting for/.test(aliceAlone.hud), JSON.stringify(aliceAlone).slice(0, 200));

  // Alice leaves from the lobby control; the cup is empty
  await alice.page.evaluate(() => globalThis.polyRanked.controller.leaveCup());
  await waitFor("Alice: main menu", () => alice.page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu && globalThis.polyRanked.controller.phase === "idle"), 30000);
  await waitFor("server: cup empty", () => ranked.cup.members.size === 0, 10000, 200);
  const api = await (await fetch(`${httpUrl}/api/cup`)).json();
  check("GET /api/cup reports the empty, idle lobby with the standings kept", api.enabled === true && api.phase === "idle" && api.players.length === 0 && api.cupsCompleted === 1, JSON.stringify({ phase: api.phase, players: api.players.length, cups: api.cupsCompleted }));

  // Bob can come back any time: the box offers to join again
  await openMultiplayerPage(bob);
  const again = await waitFor("Bob: box shows the empty lobby", async () => {
    const t = await boxStatus(bob);
    return /nobody racing/.test(t) ? t : null;
  }, 15000, 300);
  check("Bob: the multiplayer page offers to join the always-on cup again", /Always on/.test(again) && (await bob.page.evaluate(() => document.querySelector(".pr-cup-join")?.textContent?.includes("Join the Cup"))), again);

  const errors = harness.pageErrors();
  check("no PolyRanked page errors", errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));
  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error("Cup E2E failed:", err);
  await harness.screenshotAll("cup-failure");
  exitCode = 1;
} finally {
  process.exit(await harness.finish(exitCode, { keep }));
}
