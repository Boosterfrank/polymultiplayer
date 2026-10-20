#!/usr/bin/env node
/**
 * Smoke test for the self-contained game copy (tools/build-site.mjs): a brand-new browser profile
 * opens the copy, the loader must register the built-in PolyRanked mod by itself, the mod must
 * boot, connect to the baked-in server address and add its button to the main menu.
 *
 *   node test/e2e/site-smoke.mjs [--pml-dir <PolyModLoader checkout>]
 *
 * pmlcore (loaded from the PolyModLoader CDN by the loader) is replaced with a stub because the
 * test runs offline; everything else is the real game.
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
execFileSync(process.execPath, [path.join(root, "tools/build-site.mjs"), "--pml-dir", pmlDir, "--out", siteDir], { stdio: "inherit", env: { ...process.env, POLYRANKED_DEFAULT_SERVER: wsUrl } });
const site = await staticServer(siteDir);
const siteUrl = `http://127.0.0.1:${site.port}/`;
console.log(`site: ${siteUrl}  ws: ${wsUrl}`);

const stubManifest = JSON.stringify({ name: "PMLCore (stub)", author: "test", id: "pmlcore", latest: { "0.6.3": "0.0.0" } });
const stubVersion = JSON.stringify({ main: "main.mod.js", targets: ["0.6.3"], dependencies: [] });
const stubMod = `import { PolyMod } from "${siteUrl}PolyTypes.js"; export const polyMod = Object.assign(new PolyMod(), { modName: "pmlcore", modID: "pmlcore" });`;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--disable-dev-shm-usage"],
});
let exitCode = 1;
const logs = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    window.alert = (m) => console.log("[alert]", m);
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("cdn.polymodloader.com/pml/PolyModLoader/pmlcore/")) {
      if (url.endsWith("/manifest.json")) return route.fulfill({ status: 200, contentType: "application/json", body: stubManifest });
      if (url.endsWith("/version.json")) return route.fulfill({ status: 200, contentType: "application/json", body: stubVersion });
      if (url.endsWith("/main.mod.js")) return route.fulfill({ status: 200, contentType: "application/javascript", body: stubMod });
    }
    if (/kodub\.com|polymodloader\.com/.test(url)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    if (/PolyRanked|\[PML\]|\[alert\]/.test(msg.text())) console.log("  " + msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));
  await page.goto(siteUrl + "index.html");

  await waitFor("mod booted", () => page.evaluate(() => !!globalThis.polyRanked), 180000, 500);
  const mods = await page.evaluate(() => JSON.parse(localStorage.getItem("polyMods") || "[]"));
  check("loader registered the built-in mod on a fresh profile", mods.some((m) => m.base === new URL("mod", siteUrl).href.replace(/\/+$/, "") && m.loaded), JSON.stringify(mods));
  const pml = await page.evaluate(() => ({ version: window.pmlversion, mods: window.polyModLoader.getAllMods().map((m) => `${m.modID}@${m.modVersion}:${m.isLoaded}`) }));
  check("PolyModLoader reports its version from the relative package.json", /^v0\.6\.3/.test(pml.version), pml.version);
  check("pmlcore and polyranked are loaded", pml.mods.includes("pmlcore@0.0.0:true") && pml.mods.some((m) => /^polyranked@0\.\d+\.\d+:true$/.test(m)), pml.mods.join(", "));
  const polyTypesRequests = logs.filter((l) => l.includes("cdn.polymodloader.com/cb/")).length;
  check("mod bundle uses the copy's own PolyTypes.js (no CDN import)", polyTypesRequests === 0);
  await waitFor("connected", () => page.evaluate(() => globalThis.polyRanked.client.state === "ready"), 60000);
  const url = await page.evaluate(() => globalThis.polyRanked.settings.serverUrl);
  check("mod connected to the baked-in default server", url === wsUrl, url);
  await page.evaluate(() => {
    const app = globalThis.polyRanked;
    if (!(app.bridge.getState() instanceof app.bridge.getStateClasses().MainMenu)) app.bridge.backToMenu(false, null);
  });
  await waitFor("ranked button", () => page.evaluate(() => !!document.querySelector(".polyranked-menu-button")), 60000);
  check("Ranked button present in the main menu", true);
  await page.screenshot({ path: path.join(artifacts, "site-main-menu.png") });
  const errors = logs.filter((l) => l.startsWith("[pageerror]"));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | ").slice(0, 200));
  exitCode = results.every(Boolean) ? 0 : 1;
} catch (err) {
  console.error("site smoke test failed:", err);
  fs.writeFileSync(path.join(artifacts, "site-console.log"), logs.join("\n"));
} finally {
  fs.writeFileSync(path.join(artifacts, "site-console.log"), logs.join("\n"));
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  await browser.close();
  await ranked.close();
  site.srv.close();
  fs.rmSync(siteDir, { recursive: true, force: true });
  process.exit(exitCode);
}
