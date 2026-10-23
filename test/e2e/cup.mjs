#!/usr/bin/env node
/**
 * End-to-end test of the always-on cup with PolyCup-style live rounds: two players join from the
 * game's multiplayer page, warm up and ready up, start together at GO, one finishes and watches the
 * other, the other retires, the finish window and the ranking are shown, a second round on a new
 * track decides the cup, the next cup starts by itself, one player quits through the game's Exit path
 * and the other leaves from the HUD.
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
    requireVanillaPhysics: false,
    cup: {
      enabled: true,
      name: "Quickplay Cup",
      minPlayers: 2,
      maxPlayers: 8,
      rules: { roundsPerTrack: 1, pointsToWin: 18, points: [10, 8], warmup: "first-visit", warmupTiming: "fixed", warmupSeconds: 10, readyEndsWarmup: true, finishTimeoutSeconds: 4, roundBreakSeconds: 3, allowSpectatorFreecam: true, uploadLeaderboardTimes: true, pool: ["official"] },
      countdownSeconds: 3,
      loadGraceSeconds: 60,
      disconnectGraceSeconds: 5,
      lateFinishGraceMs: 300,
      roundLimit: { enabled: true, multiplier: 4, minimumSeconds: 60, withoutWrSeconds: 60 },
      breakSeconds: 4,
      idleResetSeconds: 30,
      worldRecords: { enabled: false },
    },
    tracks: TRACKS,
  },
});
const { artifacts, results, check, ranked, httpUrl, openPlayer, readyPlayer, waitFor, sleep, players } = harness;

const cupState = () => ranked.cup.publicState();
const MP_BUTTON = 'button.button-image:has(img[src="images/multiplayer.svg"])';
const openMultiplayerPage = async (p) => {
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
const text = (p, sel) => p.page.evaluate((s) => document.querySelector(s)?.innerText?.replace(/\s+/g, " ").trim() ?? "", sel);
const inGame = (p) =>
  p.page.evaluate(() => {
    const app = globalThis.polyRanked;
    return !!app.cup.connection && app.bridge.getState() instanceof app.bridge.getStateClasses().InGame && app.bridge.getState().multiplayerConnection === app.cup.connection && !!app.cup.gameInfo;
  });
const phaseIs = (p, phase) => p.page.evaluate((ph) => globalThis.polyRanked.cup.phase === ph && globalThis.polyRanked.cup.inLiveSession(), phase);
const carStarted = (p) => p.page.evaluate(() => !!globalThis.polyRanked.cup.gameInfo?.car?.hasStarted());
const raceStarted = (p) => p.page.evaluate(() => globalThis.polyRanked.cup.phase === "racing" && globalThis.polyRanked.cup.raceStarted());
const hudText = (p) => text(p, ".prc-hud");

let exitCode = 1;
try {
  const alice = await openPlayer("Alice");
  const bob = await openPlayer("Bob");
  for (const p of players) await readyPlayer(p);
  check("both players booted, signed in and in the main menu", true);
  const welcome = await alice.page.evaluate(() => globalThis.polyRanked.client.welcome?.cup);
  check("welcome announces the live cup with the preset rules", welcome?.enabled === true && welcome.phase === "idle" && welcome.rules?.target === 18 && welcome.rules.finishTimeoutSeconds === 4, JSON.stringify(welcome?.rules));
  check("the game internals the cup needs were found", await alice.page.evaluate(() => !!globalThis.polyRanked.native && typeof globalThis.polyRanked.native.reset === "function"));

  // ------------------------------------------------------------ Alice joins from the multiplayer page
  await openMultiplayerPage(alice);
  const emptyStatus = await waitFor("Alice: cup status fetched", async () => {
    const t = await boxStatus(alice);
    return /nobody racing/.test(t) ? t : null;
  }, 15000, 300);
  check("Alice: the multiplayer page shows the Join the Cup box with the live state", /Always on/.test(emptyStatus) && /first to 18/.test(emptyStatus), emptyStatus);
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-box.png") });
  await alice.page.click(".polyranked-cup .pr-cup-join");
  await waitFor("Alice: in the cup", () => alice.page.evaluate(() => globalThis.polyRanked.cup.active), 15000);
  const lobby = await waitFor("Alice: lobby overlay", () => alice.page.evaluate(() => document.querySelector(".prc-lobby-overlay:not(.hidden) .pr-lobby")?.innerText?.replace(/\s+/g, " ") ?? null), 10000);
  check("Alice: lobby overlay says she is in and waiting for racers", /You are in/.test(lobby) && /1\/2 racers/.test(lobby), lobby.slice(0, 140));
  check("server: Alice is the first member, lobby idle", ranked.cup.members.size === 1 && cupState().phase === "idle");
  const joinedStatus = await waitFor("Alice: box reflects membership", async () => {
    const t = await boxStatus(alice);
    return /You are in the cup/.test(t) ? t : null;
  }, 5000, 200);
  check("Alice: the box turns into 'Leave the cup' while she is in", /You are in the cup/.test(joinedStatus) && (await alice.page.evaluate(() => document.querySelector(".pr-cup-join")?.textContent?.includes("Leave the cup"))));

  // ------------------------------------------------------------ Bob joins: round 1 (warmup first)
  await openMultiplayerPage(bob);
  const waitingStatus = await waitFor("Bob: sees Alice waiting", async () => {
    const t = await boxStatus(bob);
    return /1 waiting/.test(t) ? t : null;
  }, 15000, 300);
  check("Bob: the box shows one racer waiting", /2 needed/.test(waitingStatus), waitingStatus);
  await clickCupButton(bob);
  for (const p of players) await waitFor(`${p.name}: round 1 started the game`, () => inGame(p), 40000, 250);
  check("both players are in the game with the cup connection", true);
  for (const p of players) await waitFor(`${p.name}: warmup`, () => phaseIs(p, "warmup"), 30000, 200);
  const warmupA = await alice.page.evaluate(() => ({
    hud: document.querySelector(".prc-hud")?.innerText?.replace(/\s+/g, " ") ?? "",
    practice: document.querySelector(".prc-practice")?.innerText?.replace(/\s+/g, " ") ?? "",
    downtime: document.querySelector(".prc-downtime")?.innerText ?? "",
    blocked: globalThis.polyRanked.cup.shouldBlockControls(globalThis.polyRanked.cup.activeGame),
    overlayHidden: document.querySelector(".prc-lobby-overlay")?.classList.contains("hidden"),
    uploads: globalThis.polyRanked.native.getUploads(globalThis.polyRanked.cup.activeGame),
    gameMode: globalThis.polyRanked.cup.gameInfo.gameMode,
    category: globalThis.polyRanked.cup.track.category,
  }));
  check("Alice: warmup – HUD shows the track, ROUND 1/1, Warmup, WR/TR lines and CUP STANDINGS", /Summer [12]/.test(warmupA.hud) && /ROUND 1\/1/.test(warmupA.hud) && /Warmup/.test(warmupA.hud) && /WR/.test(warmupA.hud) && /TR/.test(warmupA.hud) && /CUP STANDINGS/.test(warmupA.hud) && /Alice/.test(warmupA.hud) && /Bob/.test(warmupA.hud), warmupA.hud.slice(0, 200));
  check("Alice: warmup controls with the Ready button, controls free, lobby overlay closed", /0\/2 ready/.test(warmupA.practice) && /Ready/.test(warmupA.practice) && /Warmup/.test(warmupA.downtime) && warmupA.blocked === false && warmupA.overlayHidden === true, JSON.stringify(warmupA).slice(0, 300));
  check("the round runs in the game's casual multiplayer mode with leaderboard uploads on and the official track category", warmupA.gameMode === 0 && warmupA.uploads === true && warmupA.category === "official", JSON.stringify({ gameMode: warmupA.gameMode, uploads: warmupA.uploads, category: warmupA.category }));
  const track1 = await alice.page.evaluate(() => globalThis.polyRanked.cup.track.id);
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-warmup.png") });

  // ready up: the countdown starts once both are ready
  await alice.page.click(".prc-practice .prc-ready");
  await sleep(600);
  check("server: one racer ready keeps the warmup going", ranked.cup.phase === "warmup" && ranked.cup.run.warmupReady.size === 1, `${ranked.cup.phase} ${ranked.cup.run?.warmupReady.size}`);
  const readyB = await text(bob, ".prc-practice");
  check("Bob: sees 1/2 ready", /1\/2 ready/.test(readyB), readyB);
  await bob.page.click(".prc-practice .prc-ready");
  for (const p of players) await waitFor(`${p.name}: countdown`, () => phaseIs(p, "countdown"), 10000, 100);
  const cue = await waitFor("Alice: start cue", () => alice.page.evaluate(() => document.querySelector(".prc-start-cue:not(.hidden)")?.textContent || null), 4000, 50);
  const blockedInCountdown = await alice.page.evaluate(() => globalThis.polyRanked.cup.shouldBlockControls(globalThis.polyRanked.cup.activeGame));
  check("countdown: 3-2-1 cue shown and the controls are held", /^[123]$/.test(cue) && blockedInCountdown === true, `cue=${cue} blocked=${blockedInCountdown}`);
  for (const p of players) await waitFor(`${p.name}: GO`, () => raceStarted(p), 10000, 50);
  const goCue = await waitFor("Alice: GO! cue", () => alice.page.evaluate(() => (document.querySelector(".prc-start-cue:not(.hidden)")?.textContent === "GO!" ? "GO!" : null)), 1500, 30);
  check("GO! cue", goCue === "GO!", goCue);
  await sleep(700);
  const started = await Promise.all(players.map((p) => carStarted(p)));
  check("GO: both cars' clocks started without any input", started.every(Boolean), JSON.stringify(started));
  const liveHud = await hudText(alice);
  check("Alice: live round – ROUND RANKING heading", /Live round/.test(liveHud) && /ROUND RANKING/.test(liveHud), liveHud.slice(0, 160));

  // Alice reports a checkpoint, then finishes; Bob sees the finish window and Alice watches Bob
  await sleep(2500);
  await alice.page.evaluate(() => globalThis.polyRanked.cup.reportCheckpoint(0, 2000));
  const cpB = await waitFor("Bob: Alice's checkpoint in the ranking", async () => {
    const live = await bob.page.evaluate(() => globalThis.polyRanked.cup.state.live);
    return live?.splits?.[1] || live?.splits?.[2] ? live : null;
  }, 5000, 100);
  check("the checkpoint reached the live state", Object.values(cpB.splits)[0].index === 0, JSON.stringify(cpB.splits));
  await alice.page.evaluate(() => globalThis.polyRanked.cup.reportFinish(3000));
  const timerB = await waitFor("Bob: finish-window timer", () => bob.page.evaluate(() => document.querySelector(".prc-round-timer.visible")?.textContent || null), 5000, 50);
  check("Bob: the finish window counts down after Alice's finish", /^[1-4]s$/.test(timerB), timerB);
  const spectate = await waitFor("Alice: spectating Bob", () => alice.page.evaluate(() => {
    const cup = globalThis.polyRanked.cup;
    if (!cup.view.following) return null;
    const info = cup.gameInfo;
    const remote = info.remoteCars.get(cup.view.watchSlot);
    return { watch: cup.view.watchSlot, name: cup.playerName(cup.view.watchSlot), cameraIsRemoteOrbit: info.renderer.camera === remote?.car?.cameraOrbit, pov: document.querySelector(".prc-pov:not(.hidden)")?.innerText?.replace(/\s+/g, " ") ?? "", pb: document.querySelector(".prc-pb:not(.hidden)")?.innerText?.replace(/\s+/g, " ") ?? "", blocked: cup.shouldBlockControls(cup.activeGame) };
  }), 5000, 100);
  check("Alice: after finishing she follows Bob's car with the chase camera, spectator selector and PB box shown, controls held", spectate.name === "Bob" && spectate.cameraIsRemoteOrbit && /Bob/.test(spectate.pov) && /PB/.test(spectate.pb) && spectate.blocked === true, JSON.stringify(spectate));
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-spectating.png") });
  const rankingB = await hudText(bob);
  check("Bob: ROUND RANKING lists Alice first with her time and the provisional +10", /ROUND RANKING/.test(rankingB) && /Alice/.test(rankingB) && /0:03\.000/.test(rankingB) && /\+10/.test(rankingB), rankingB.slice(0, 220));

  // Bob retires with the restart key
  await bob.page.keyboard.press("KeyT");
  await waitFor("server: round 1 over", () => ranked.cup.phase !== "racing", 8000, 100);
  const retired = await bob.page.evaluate(() => ({ retired: globalThis.polyRanked.cup.runtime?.retired ?? null, done: globalThis.polyRanked.cup.runtime?.done ?? null }));
  check("Bob: T retired him (DNF) and that closed the round", retired.retired === true && ranked.cup.lastRound?.dnfs?.length === 1, JSON.stringify({ ...retired, dnfs: ranked.cup.lastRound?.dnfs }));
  check("round 1: Alice 10 points, Bob 0", JSON.stringify(ranked.cup.pointsBySlot()) === JSON.stringify({ 1: 10, 2: 0 }), JSON.stringify(ranked.cup.pointsBySlot()));
  const standingsA = await waitFor("Alice: CUP STANDINGS after the round", async () => {
    const t = await hudText(alice);
    return /CUP STANDINGS/.test(t) ? t : null;
  }, 5000, 100);
  const track1Name = TRACKS.find((t) => t.id === track1)?.name ?? "?";
  check("Alice: standings keep the raced track with its record, +10 for her and DNF for Bob", standingsA.includes(track1Name) && /\+10/.test(standingsA) && /DNF/.test(standingsA) && /TR Alice 0:03\.000/.test(standingsA), standingsA.slice(0, 260));
  const resumed = await alice.page.evaluate(() => ({ following: globalThis.polyRanked.cup.view.following, ownVisible: globalThis.polyRanked.cup.gameInfo?.car?.visible ?? null }));
  check("Alice: the camera is back on her own car once the round is over", resumed.following === false, JSON.stringify(resumed));

  // ------------------------------------------------------------ round 2 on the other track decides the cup
  for (const p of players) await waitFor(`${p.name}: round 2 game`, () => p.page.evaluate(() => globalThis.polyRanked.cup.state?.round === 2 && !!globalThis.polyRanked.cup.gameInfo && globalThis.polyRanked.cup.gameInfo.sessionId === globalThis.polyRanked.cup.state.live?.sessionId), 30000, 200);
  const track2 = await alice.page.evaluate(() => globalThis.polyRanked.cup.track.id);
  check("round 2 is raced on the other track (new warmup)", track2 !== track1 && TRACKS.some((t) => t.id === track2) && ranked.cup.run?.warmup === true, `${track1.slice(0, 8)} -> ${track2.slice(0, 8)}`);
  for (const p of players) await waitFor(`${p.name}: warmup 2`, () => phaseIs(p, "warmup"), 30000, 200);
  for (const p of players) await p.page.click(".prc-practice .prc-ready");
  for (const p of players) await waitFor(`${p.name}: GO 2`, () => raceStarted(p), 15000, 50);
  await sleep(3500);
  await alice.page.evaluate(() => globalThis.polyRanked.cup.reportFinish(2600));
  await bob.page.evaluate(() => globalThis.polyRanked.cup.reportFinish(3200));
  await waitFor("server: cup over", () => ranked.cup.phase === "complete", 10000, 100);
  for (const p of players) await waitFor(`${p.name}: cup over in the HUD`, async () => /CUP WINNER/.test(await hudText(p)), 8000, 100);
  const overA = await alice.page.evaluate(() => ({ hud: document.querySelector(".prc-hud")?.innerText?.replace(/\s+/g, " ") ?? "", phase: document.querySelector(".prc-phase")?.innerText ?? "", notice: document.querySelector(".prc-notice")?.innerText ?? "" }));
  check("Alice: winner strip, final standings 20/8, next cup countdown", /CUP WINNER Alice/.test(overA.hud) && /20/.test(overA.hud) && /8/.test(overA.hud) && /Cup over/.test(overA.phase) && /next cup in/.test(overA.phase) && /You win the cup/.test(overA.notice), JSON.stringify(overA).slice(0, 300));
  check("server: cup #1 completed, winner recorded for the cup leaderboard", ranked.cup.cupsCompleted === 1 && ranked.players.cupLeaderboard(5)[0]?.nickname === "Alice" && ranked.players.cupLeaderboard(5)[0]?.wins === 1, JSON.stringify(ranked.players.cupLeaderboard(5)));
  await alice.page.screenshot({ path: path.join(artifacts, "Alice-cup-over.png") });

  // the next cup starts by itself after the break
  await waitFor("cup #2 round 1", () => alice.page.evaluate(() => globalThis.polyRanked.cup.state?.cupNumber === 2 && globalThis.polyRanked.cup.state.round === 1 && ["loading", "warmup", "countdown", "racing"].includes(globalThis.polyRanked.cup.phase)), 30000);
  for (const p of players) await waitFor(`${p.name}: in game for cup #2`, () => inGame(p), 20000, 250);
  const cup2 = await alice.page.evaluate(() => ({ points: globalThis.polyRanked.cup.state.players.map((p) => p.points), winner: globalThis.polyRanked.cup.state.winner }));
  check("cup #2 started automatically with the standings reset", cup2.points.every((v) => v === 0) && cup2.winner === null, JSON.stringify(cup2));

  // Bob quits through the game's Exit path; Alice ends up waiting for racers
  await bob.page.evaluate(() => globalThis.polyRanked.bridge.backToMenu(false, null));
  await waitFor("server: Bob removed", () => ranked.cup.members.size === 1, 10000, 200);
  const bobAfter = await bob.page.evaluate(() => ({ active: globalThis.polyRanked.cup.active, notice: globalThis.polyRanked.menu.notice?.text ?? "" }));
  check("Bob: cup controller idle after exiting, told he left the cup", bobAfter.active === false && /left the cup/.test(bobAfter.notice), JSON.stringify(bobAfter));
  await waitFor("Alice: warmup alone", () => phaseIs(alice, "warmup"), 30000, 200);
  await alice.page.click(".prc-practice .prc-ready");
  await waitFor("Alice: GO alone", () => raceStarted(alice), 15000, 50);
  await sleep(3000);
  await alice.page.evaluate(() => globalThis.polyRanked.cup.reportFinish(2800));
  await waitFor("server: cup idle with Alice alone", () => ranked.cup.phase === "idle" && ranked.cup.members.size === 1, 30000, 200);
  const aliceAlone = await alice.page.evaluate(() => ({ players: globalThis.polyRanked.cup.state?.players?.length, hud: document.querySelector(".prc-hud")?.innerText?.replace(/\s+/g, " ") ?? "", active: globalThis.polyRanked.cup.active }));
  check("Alice: still in the cup, HUD waits for racers", aliceAlone.active && aliceAlone.players === 1 && /Waiting for racers/.test(aliceAlone.hud), JSON.stringify(aliceAlone).slice(0, 200));

  // Alice leaves; the cup is empty
  await alice.page.evaluate(() => globalThis.polyRanked.cup.leaveCup());
  await waitFor("Alice: main menu", () => alice.page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu && !globalThis.polyRanked.cup.active), 30000);
  await waitFor("server: cup empty", () => ranked.cup.members.size === 0, 10000, 200);
  const api = await (await fetch(`${httpUrl}/api/cup`)).json();
  check("GET /api/cup reports the empty, idle lobby with the rules and the cup count", api.enabled === true && api.phase === "idle" && api.players.length === 0 && api.cupsCompleted === 1 && api.rules.target === 18 && api.live === null, JSON.stringify({ phase: api.phase, players: api.players.length, cups: api.cupsCompleted }));

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
