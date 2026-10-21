#!/usr/bin/env node
/**
 * Builds a self-contained copy of the PolyModLoader web version with PolyRanked pre-installed.
 *
 *   node tools/build-site.mjs [--pml-dir <PolyModLoader checkout>] [--out dist/site]
 *
 * Without --pml-dir the pinned PolyModLoader commit is fetched into .cache/pml.
 * POLYRANKED_DEFAULT_SERVER=wss://... bakes the ranked server address into the mod.
 *
 * What the copy changes compared to upstream PolyModLoader:
 *  - PolyModLoader.js: the mod list always contains the PolyRanked mod served from ./mod
 *    (added once; players can still unload it in the mod manager), and the version lookup
 *    uses a relative path so the copy also works from a sub-directory (GitHub Pages).
 *  - ./mod: the PolyRanked mod files, importing PolyTypes.js from the copy itself.
 *  - main.bundle.js: the first-launch tutorial is skipped (the mod asks new players to visit the
 *    Garage instead) and, when POLYRANKED_KODUB_PROXY=<url> is set, PolyTrack's backend
 *    (leaderboards, invite-code multiplayer) is reached through that proxy (see
 *    server/src/kodubproxy.js) because the official servers only accept known origins.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PML_REPO = "https://github.com/polytrackmods/PolyModLoader";
/** PolyModLoader 0.6.3 (branch 0.6.3, 2026-10-10). Bump together with the mod's `targets`. */
const PML_COMMIT = "aea33b2b2593beaa5cfb657bcd0c81a39a46f464";
const EXCLUDE_TOP = new Set([".git", ".forgejo", ".github", ".woodpecker", "src", "electron", "node_modules", "package-lock.json", ".gitignore", "README.md"]);

const args = process.argv.slice(2);
const argValue = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = path.resolve(root, argValue("--out", "dist/site"));
let pmlDir = argValue("--pml-dir", process.env.PML_DIR ?? null);

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
}

function assertReplace(source, search, replacement, label) {
  const idx = source.indexOf(search);
  if (idx === -1) throw new Error(`patch anchor not found: ${label}`);
  if (source.indexOf(search, idx + 1) !== -1) throw new Error(`patch anchor is ambiguous: ${label}`);
  return source.slice(0, idx) + replacement + source.slice(idx + search.length);
}

// 1. PolyModLoader sources
if (!pmlDir) {
  pmlDir = path.join(root, ".cache", "pml");
  if (!fs.existsSync(path.join(pmlDir, "main.bundle.js"))) {
    console.log(`[site] fetching PolyModLoader ${PML_COMMIT.slice(0, 7)} into ${path.relative(root, pmlDir)}`);
    fs.rmSync(pmlDir, { recursive: true, force: true });
    fs.mkdirSync(pmlDir, { recursive: true });
    run("git", ["init", "-q"], { cwd: pmlDir });
    run("git", ["remote", "add", "origin", PML_REPO], { cwd: pmlDir });
    run("git", ["fetch", "-q", "--depth", "1", "origin", PML_COMMIT], { cwd: pmlDir });
    run("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: pmlDir });
  }
}
pmlDir = path.resolve(pmlDir);
for (const f of ["main.bundle.js", "PolyModLoader.js", "PolyTypes.js", "index.html", "package.json"]) {
  if (!fs.existsSync(path.join(pmlDir, f))) throw new Error(`${pmlDir} does not look like a PolyModLoader checkout (missing ${f})`);
}
try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: pmlDir, encoding: "utf8" }).trim();
  if (head !== PML_COMMIT) console.warn(`[site] warning: PolyModLoader checkout is at ${head.slice(0, 7)}, the mod was built for ${PML_COMMIT.slice(0, 7)}`);
} catch {
  /* not a git checkout; fine */
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const modVersion = manifest.latest["0.6.3"];

// 3. Copy the game + loader
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const entry of fs.readdirSync(pmlDir)) {
  if (EXCLUDE_TOP.has(entry)) continue;
  fs.cpSync(path.join(pmlDir, entry), path.join(outDir, entry), {
    recursive: true,
    filter: (src) => !/(^|[\\/])\.DS_Store$/.test(src),
  });
}

// 4. Patch the loader
const loaderPath = path.join(outDir, "PolyModLoader.js");
let loader = fs.readFileSync(loaderPath, "utf8");
loader = assertReplace(loader, 'fetch("/package.json", { signal: AbortSignal.timeout(3000) })', 'fetch("package.json", { signal: AbortSignal.timeout(3000) })', "package.json fetch");

const storageStart = loader.indexOf("getPolyModsStorage() {");
if (storageStart === -1) throw new Error("patch anchor not found: getPolyModsStorage");
const returnLine = 'return __classPrivateFieldGet(this, _PolyModLoaderImpl_polyModUrls, "f");';
const returnIdx = loader.indexOf(returnLine, storageStart);
if (returnIdx === -1) throw new Error("patch anchor not found: getPolyModsStorage return");
const ensureBlock = `/* PolyRanked: the built-in mod is always in the list (added once; players may still unload it). */
        try {
            const polyRankedBase = new URL("mod", document.baseURI).href.replace(/\\/+$/, "");
            const polyRankedKnown = ["boosterfrank/polymultiplayer", polyRankedBase];
            const polyRankedList = __classPrivateFieldGet(this, _PolyModLoaderImpl_polyModUrls, "f") || [];
            const polyRankedPresent = polyRankedList.some((m) => m && typeof m.base === "string" && polyRankedKnown.some((k) => m.base.replace(/\\/+$/, "").includes(k)));
            if (!polyRankedPresent) {
                polyRankedList.push({ "base": polyRankedBase, "version": "latest", "loaded": true });
                __classPrivateFieldSet(this, _PolyModLoaderImpl_polyModUrls, polyRankedList, "f");
                this.localStorage?.setItem("polyMods", JSON.stringify(polyRankedList));
            }
        }
        catch (polyRankedErr) {
            console.warn("[PolyRanked] could not register the built-in mod", polyRankedErr);
        }
        `;
loader = loader.slice(0, returnIdx) + ensureBlock + loader.slice(returnIdx);
fs.writeFileSync(loaderPath, loader);

// 4b. Patch the game bundle: no first-launch tutorial, optional backend proxy
const bundleGamePath = path.join(outDir, "main.bundle.js");
let game = fs.readFileSync(bundleGamePath, "utf8");
game = assertReplace(game, ': { type: "tutorial" };', ": null; /* PolyRanked: no first-launch tutorial */", "tutorial startup action");
const kodubProxy = (process.env.POLYRANKED_KODUB_PROXY ?? argValue("--kodub-proxy", "")).trim().replace(/\/+$/, "");
let proxiedCalls = 0;
if (kodubProxy) {
  if (!/^https?:\/\//.test(kodubProxy)) throw new Error("POLYRANKED_KODUB_PROXY must be an http(s) URL, e.g. https://ranked.example.com/kodub");
  const needle = '"https://vps.kodub.com/"';
  proxiedCalls = game.split(needle).length - 1;
  if (proxiedCalls === 0) throw new Error("patch anchor not found: vps.kodub.com");
  game = game.split(needle).join(JSON.stringify(kodubProxy + "/"));
}
fs.writeFileSync(bundleGamePath, game);

// 5. Build the mod straight into the copy (the repo's own version folder is left untouched),
//    importing PolyTypes from the copy instead of the CDN
const modOut = path.join(outDir, "mod");
fs.mkdirSync(path.join(modOut, modVersion), { recursive: true });
fs.copyFileSync(path.join(root, "manifest.json"), path.join(modOut, "manifest.json"));
for (const f of fs.readdirSync(path.join(root, modVersion))) {
  if (f !== "main.mod.js") fs.copyFileSync(path.join(root, modVersion, f), path.join(modOut, modVersion, f));
}
run(process.execPath, [path.join(root, "mod/build.mjs"), "--outdir", path.join(modOut, modVersion)], { cwd: root });
const bundlePath = path.join(modOut, modVersion, "main.mod.js");
let bundle = fs.readFileSync(bundlePath, "utf8");
bundle = assertReplace(bundle, 'from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js"', 'from "../../PolyTypes.js"', "PolyTypes import");
fs.writeFileSync(bundlePath, bundle);

// 6. Static-host niceties
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
fs.writeFileSync(
  path.join(outDir, "polyranked-site.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), pmlCommit: PML_COMMIT, modVersion, defaultServer: process.env.POLYRANKED_DEFAULT_SERVER ?? "ws://localhost:8788", kodubProxy: kodubProxy || null, tutorial: false }, null, 2) + "\n",
);

let total = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : (total += fs.statSync(path.join(d, e.name)).size);
};
walk(outDir);
console.log(`[site] built ${path.relative(root, outDir)} (${(total / 1024 / 1024).toFixed(1)} MB): PolyModLoader ${PML_COMMIT.slice(0, 7)} + PolyRanked ${modVersion}, default server ${process.env.POLYRANKED_DEFAULT_SERVER ?? "ws://localhost:8788"}, tutorial off${kodubProxy ? `, backend via ${kodubProxy} (${proxiedCalls} call sites)` : ""}`);
