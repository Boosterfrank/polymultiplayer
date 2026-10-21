#!/usr/bin/env node
/**
 * Smoke test for the self-contained game copy (tools/build-site.mjs).
 *
 *   node test/e2e/site-smoke.mjs [--pml-dir <PolyModLoader checkout>]
 *
 * Page 1 is a brand-new profile: the loader must register the built-in mods (PolyRanked off,
 * PolyCup on), the copy must skip the tutorial and show the Garage prompt instead.
 * Page 2 is a profile that enabled PolyRanked: the mod must boot, connect to the baked-in server
 * and add its menu button. pmlcore and PolyCup (loaded from the PolyModLoader CDN) are replaced
 * with stubs because the test runs offline; everything else is the real game.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
const pmlDir = argValue("--pml-dir", process.env.POLYTRACK_DIR ?? process.env.PML_DIR ?? "/home/user/polytrackmods/polymodloader");
const artifacts = path.join(root, "e2e-artifacts");
fs.mkdirSync(artifacts, { recursive: true });

const MIME = { ".js": "application/javascript", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".track": "text/plain", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".jpg": "image/jpeg" };
function staticServer(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      let file = path.join(dir, decodeURIComponent(url.pathname));
      if (url.pathname === "/") file = path.join(dir, "index.html");
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
async function waitFor(label, fn, timeoutMs = 60000, interval = 300) {
  const start = Date.now();
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = undefined;
    }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(interval);
  }
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
};

// ranked server first: its port is baked into the site as the default server
const ranked = createServer(deepMerge(DEFAULT_CONFIG, { port: 0, host: "127.0.0.1", requireVanillaPhysics: false }), { log: { info() {}, warn() {}, error: console.error }, storePath: null });
const rankedAddr = await ranked.listen();
const wsUrl = `ws://127.0.0.1:${rankedAddr.port}`;

const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), "polyranked-site-"));
const proxyBase = `http://127.0.0.1:${rankedAddr.port}/kodub`;
execFileSync(process.execPath, [path.join(root, "tools/build-site.mjs"), "--pml-dir", pmlDir, "--out", siteDir], { stdio: "inherit", env: { ...process.env, POLYRANKED_DEFAULT_SERVER: wsUrl, POLYRANKED_KODUB_PROXY: proxyBase } });
const builtBundle = fs.readFileSync(path.join(siteDir, "main.bundle.js"), "utf8");
check("built copy has no tutorial startup action", !builtBundle.includes(': { type: "tutorial" };') && builtBundle.includes('case "polyranked-garage"'));
check("built copy routes PolyTrack's backend through the proxy", !builtBundle.includes('"https://vps.kodub.com/"') && builtBundle.split(JSON.stringify(proxyBase + "/")).length - 1 >= 10);
const site = await staticServer(siteDir);
const siteUrl = `http://127.0.0.1:${site.port}/`;
const selfModBase = `${siteUrl}mod`;
const POLYCUP_BASE = "https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist";
console.log(`site: ${siteUrl}  ws: ${wsUrl}`);

const stubFor = (id, name) => ({
  manifest: JSON.stringify({ name, author: "test", id, latest: { "0.6.3": "0.0.0" } }),
  version: JSON.stringify({ main: "main.mod.js", targets: ["0.6.3"], dependencies: [] }),
  mod: `import { PolyMod } from "${siteUrl}PolyTypes.js"; export const polyMod = Object.assign(new PolyMod(), { modName: ${JSON.stringify(name)}, modID: ${JSON.stringify(id)} });`,
});
const stubs = [
  ["cdn.polymodloader.com/pml/PolyModLoader/pmlcore/", stubFor("pmlcore", "PMLCore (stub)")],
  ["cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist/", stubFor("polytrack-world-cup", "PolyCup (stub)")],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--disable-dev-shm-usage"],
});

async function openPage(name, initScript) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  await context.addInitScript(() => {
    window.alert = (m) => console.log("[alert]", m);
  });
  if (initScript) await context.addInitScript(initScript.fn, initScript.arg);
  await context.route("**/*", (route) => {
    const url = route.request().url();
    for (const [prefix, stub] of stubs) {
      if (!url.includes(prefix)) continue;
      if (url.endsWith("/manifest.json")) return route.fulfill({ status: 200, contentType: "application/json", body: stub.manifest });
      if (url.endsWith("/version.json")) return route.fulfill({ status: 200, contentType: "application/json", body: stub.version });
      if (url.endsWith("/main.mod.js")) return route.fulfill({ status: 200, contentType: "application/javascript", body: stub.mod });
    }
    if (/kodub\.com|polymodloader\.com/.test(url)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    if (/PolyRanked|\[PML\]|\[alert\]/.test(msg.text())) console.log(`  (${name}) ` + msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));
  await page.goto(siteUrl + "index.html");
  return { name, page, logs };
}

const gameState = (page) =>
  page.evaluate(() => {
    const pml = window.polyModLoader;
    const state = pml?.__rankedState;
    return state ?? null;
  });

let exitCode = 1;
const pages = [];
try {
  // ---------------------------------------------------------------- page 1: brand-new profile
  const fresh = await openPage("fresh");
  pages.push(fresh);
  await waitFor("fresh: mods imported", () => fresh.page.evaluate(() => window.polyModLoader?.getAllMods?.().length >= 3), 180000, 500);
  const mods = await fresh.page.evaluate(() => JSON.parse(localStorage.getItem("polyMods") || "[]"));
  const rankedEntry = mods.find((m) => m.base === selfModBase);
  const cupEntry = mods.find((m) => m.base === POLYCUP_BASE);
  check("fresh: PolyRanked registered but not loaded", !!rankedEntry && rankedEntry.loaded === false, JSON.stringify(rankedEntry));
  check("fresh: PolyCup registered and loaded", !!cupEntry && cupEntry.loaded === true, JSON.stringify(cupEntry));
  const loaded = await fresh.page.evaluate(() => window.polyModLoader.getAllMods().map((m) => `${m.modID}:${m.isLoaded}`));
  check("fresh: pmlcore and polycup active, polyranked present but inactive", loaded.includes("pmlcore:true") && loaded.includes("polytrack-world-cup:true") && loaded.includes("polyranked:false"), loaded.join(", "));
  const prompt = await waitFor("fresh: garage prompt", () => fresh.page.evaluate(() => {
    const dialog = document.querySelector("dialog.message-box-ui");
    return dialog && dialog.open ? dialog.innerText : null;
  }), 120000, 500);
  check("fresh: the tutorial is replaced by the Garage prompt", /Garage/.test(prompt) && /Later/.test(prompt), prompt.replace(/\s+/g, " ").slice(0, 100));
  check("fresh: PolyRanked mod code did not run", await fresh.page.evaluate(() => typeof globalThis.polyRanked === "undefined" && typeof globalThis.__polyRankedBridge === "undefined"));
  await fresh.page.screenshot({ path: path.join(artifacts, "site-garage-prompt.png") });
  await fresh.page.click("dialog.message-box-ui button:has-text('Go to Garage')");
  await waitFor("fresh: garage", () => fresh.page.evaluate(() => !document.querySelector(".polyranked-menu-button") && !document.querySelector("dialog.message-box-ui[open]") && !!document.querySelector("#ui *")), 30000);
  await sleep(1500);
  await fresh.page.screenshot({ path: path.join(artifacts, "site-garage.png") });
  const garageText = await fresh.page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  check("fresh: 'Go to Garage' leaves the main menu", !/Ranked 1v1|Multiplayer\s+Play/.test(garageText) && /Back|Save|Nickname|Garage|Name/i.test(garageText), garageText.slice(0, 120));
  check("fresh: the prompt is remembered", await fresh.page.evaluate(() => localStorage.getItem("polyranked.garagePrompted") === "1"));

  // ---------------------------------------------------------------- page 2: PolyRanked enabled
  const enabled = await openPage("enabled", {
    fn: ({ selfModBase, polycup }) => {
      localStorage.setItem("polyMods", JSON.stringify([
        { base: "https://cdn.polymodloader.com/pml/PolyModLoader/pmlcore", version: "latest", loaded: true },
        { base: selfModBase, version: "latest", loaded: true },
        { base: polycup, version: "latest", loaded: true },
      ]));
      localStorage.setItem("polyranked.garagePrompted", "1");
    },
    arg: { selfModBase, polycup: POLYCUP_BASE },
  });
  pages.push(enabled);
  await waitFor("enabled: mod booted", () => enabled.page.evaluate(() => !!globalThis.polyRanked), 180000, 500);
  const pml = await enabled.page.evaluate(() => ({ version: window.pmlversion, mods: window.polyModLoader.getAllMods().map((m) => `${m.modID}@${m.modVersion}:${m.isLoaded}`), polyMods: JSON.parse(localStorage.getItem("polyMods")).length }));
  check("enabled: PolyModLoader reports its version from the relative package.json", /^v0\.6\.3/.test(pml.version), pml.version);
  check("enabled: all three mods loaded, nothing registered twice", pml.mods.some((m) => /^polyranked@0\.\d+\.\d+:true$/.test(m)) && pml.mods.includes("polytrack-world-cup@0.0.0:true") && pml.polyMods === 3, pml.mods.join(", "));
  check("enabled: mod bundle uses the copy's own PolyTypes.js (no CDN import)", !enabled.logs.some((l) => l.includes("cdn.polymodloader.com/cb/")));
  await waitFor("enabled: connected", () => enabled.page.evaluate(() => globalThis.polyRanked.client.state === "ready"), 60000);
  check("enabled: mod connected to the baked-in default server", await enabled.page.evaluate(() => globalThis.polyRanked.settings.serverUrl) === wsUrl);
  await waitFor("enabled: ranked button", () => enabled.page.evaluate(() => !!document.querySelector(".polyranked-menu-button")), 60000);
  check("enabled: Ranked button present in the main menu", true);
  check("enabled: no duplicate Garage prompt", await enabled.page.evaluate(() => !document.querySelector("dialog.message-box-ui[open]")));
  await enabled.page.screenshot({ path: path.join(artifacts, "site-main-menu.png") });

  const errors = pages.flatMap((p) => p.logs.filter((l) => l.startsWith("[pageerror]")).map((l) => `${p.name}: ${l}`));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | ").slice(0, 200));
  exitCode = results.every(Boolean) ? 0 : 1;
} catch (err) {
  console.error("site smoke test failed:", err);
  for (const p of pages) {
    try {
      await p.page.screenshot({ path: path.join(artifacts, `site-${p.name}-failure.png`) });
    } catch {
      /* ignore */
    }
  }
} finally {
  for (const p of pages) fs.writeFileSync(path.join(artifacts, `site-${p.name}-console.log`), p.logs.join("\n"));
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  await browser.close();
  await ranked.close();
  site.srv.close();
  fs.rmSync(siteDir, { recursive: true, force: true });
  process.exit(exitCode);
}
