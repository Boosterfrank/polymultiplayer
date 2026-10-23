/**
 * Shared harness for the headless-Chromium end-to-end tests: serves the real PolyModLoader build,
 * starts a PolyRanked server with the mod served from this repository, and opens player pages with
 * the mod pre-installed. External hosts (kodub.com, polymodloader.com) are blocked; the CDN import
 * of PolyTypes.js is answered from the game checkout, so the tests run offline.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "../../server/src/index.js";
import { deepMerge, DEFAULT_CONFIG } from "../../server/src/config.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const artifacts = path.join(root, "e2e-artifacts");

const MIME = { ".js": "application/javascript", ".json": "application/json", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".glb": "model/gltf-binary", ".track": "text/plain", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".css": "text/css", ".jpg": "image/jpeg" };

export function staticServer(dir) {
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(label, fn, timeoutMs = 60000, interval = 250) {
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

export function parseArgs(argv = process.argv.slice(2)) {
  const argValue = (flag, def) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : def;
  };
  return {
    gameDir: path.resolve(argValue("--game-dir", process.env.POLYTRACK_DIR ?? "/home/user/polytrackmods/polymodloader")),
    headed: argv.includes("--headed"),
    keep: argv.includes("--keep"),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.gameDir PolyModLoader checkout with main.bundle.js
 * @param {object} opts.serverCfg config overrides for the PolyRanked server
 * @param {boolean} [opts.headed]
 */
export async function createHarness({ gameDir, serverCfg, headed = false }) {
  fs.mkdirSync(artifacts, { recursive: true });
  if (!fs.existsSync(path.join(gameDir, "main.bundle.js"))) throw new Error(`game directory ${gameDir} does not contain main.bundle.js`);

  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  – " + detail : ""}`);
  };

  const game = await staticServer(gameDir);
  const cfg = deepMerge(deepMerge(DEFAULT_CONFIG, { port: 0, host: "127.0.0.1", serveModFrom: root }), serverCfg);
  const ranked = createServer(cfg, { log: { info: (...a) => console.log("[server]", ...a), warn: console.warn, error: console.error }, storePath: null });
  const rankedAddr = await ranked.listen();
  const wsUrl = `ws://127.0.0.1:${rankedAddr.port}`;
  const httpUrl = `http://127.0.0.1:${rankedAddr.port}`;
  const modUrl = `${httpUrl}/mod`;
  const gameUrl = `http://127.0.0.1:${game.port}/index.html`;
  console.log(`game: ${gameUrl}\nmod:  ${modUrl}\nws:   ${wsUrl}`);

  const executablePath = process.env.CHROMIUM_PATH ?? ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({
    headless: !headed,
    executablePath,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage"],
  });
  const polyTypesSource = fs.readFileSync(path.join(gameDir, "PolyTypes.js"), "utf8");
  const players = [];

  async function openPlayer(name) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const logs = [];
    await context.addInitScript(
      ({ modUrl, wsUrl, name }) => {
        localStorage.setItem("polyMods", JSON.stringify([{ base: modUrl, version: "latest", loaded: true }]));
        localStorage.setItem("polyranked.settings", JSON.stringify({ serverUrl: wsUrl, autoConnect: true, nameOverride: name, showHud: true }));
        // a fresh profile would (re)start the tutorial from the main menu; the players start in the menu instead
        localStorage.setItem("polytrack_v5_prod_startup_info", JSON.stringify({ lastVersion: "0.6.3", isTutorialCompleted: true }));
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
    const player = { name, page, context, logs };
    players.push(player);
    return player;
  }

  /** Boot the mod, sign in, leave the tutorial for the main menu. */
  async function readyPlayer(p) {
    await waitFor(`${p.name}: mod booted`, () => p.page.evaluate(() => !!globalThis.polyRanked), 180000, 500);
    await waitFor(`${p.name}: connected to ranked server`, () => p.page.evaluate(() => globalThis.polyRanked.client.state === "ready"), 60000);
    const inMenu = await p.page.evaluate(() => {
      const app = globalThis.polyRanked;
      const inMenu = app.bridge.getState() instanceof app.bridge.getStateClasses().MainMenu;
      if (!inMenu) app.bridge.backToMenu(false, null);
      return inMenu;
    });
    if (!inMenu) await waitFor(`${p.name}: main menu`, () => p.page.evaluate(() => globalThis.polyRanked.bridge.getState() instanceof globalThis.polyRanked.bridge.getStateClasses().MainMenu), 30000);
    await waitFor(`${p.name}: main menu button`, () => p.page.evaluate(() => !!document.querySelector(".polyranked-menu-button")), 120000, 500);
  }

  const pageErrors = () => players.flatMap((p) => p.logs.filter((l) => l.startsWith("[pageerror]") || (l.startsWith("[error]") && /PolyRanked|polyranked/i.test(l))).map((l) => `${p.name}: ${l}`));

  async function finish(exitCode, { keep = false } = {}) {
    for (const p of players) fs.writeFileSync(path.join(artifacts, `${p.name}-console.log`), p.logs.join("\n"));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed; artifacts in ${path.relative(root, artifacts)}/`);
    if (!keep) {
      await browser.close();
      await ranked.close();
      game.srv.close();
    }
    return exitCode;
  }

  async function screenshotAll(suffix) {
    for (const p of players) {
      try {
        await p.page.screenshot({ path: path.join(artifacts, `${p.name}-${suffix}.png`) });
      } catch {
        /* ignore */
      }
    }
  }

  return { root, artifacts, results, check, game, ranked, cfg, wsUrl, httpUrl, modUrl, gameUrl, browser, players, openPlayer, readyPlayer, pageErrors, finish, screenshotAll, waitFor, sleep };
}
