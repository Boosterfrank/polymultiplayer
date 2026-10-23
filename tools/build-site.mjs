#!/usr/bin/env node
/**
 * Builds a self-contained copy of the PolyModLoader web version with PolyRanked pre-installed.
 *
 *   node tools/build-site.mjs [--pml-dir <PolyModLoader checkout>] [--out dist/site]
 *                             [--ranked-enabled] [--extra-mod <url>[=on|off]]...
 *
 * Without --pml-dir the pinned PolyModLoader commit is fetched into .cache/pml.
 * POLYRANKED_DEFAULT_SERVER=wss://... bakes the ranked server address into the mod.
 * POLYRANKED_RANKED_ENABLED=1 (or --ranked-enabled) ships PolyRanked switched on; by default it is
 * installed but off, so players enable it in the mod manager. POLYRANKED_EXTRA_MODS can list more
 * mods to pre-install, comma separated (`<url>` or `<url>=off`).
 *
 * What the copy changes compared to upstream PolyModLoader:
 *  - PolyModLoader.js: the mod list always contains the built-in mods (PolyRanked served from
 *    ./mod, PolyCup from the PolyModLoader CDN, the ported Car Switcher / Cool Cars / Goofy Cars
 *    from ./mods); each is added once, players can still unload or remove them in the mod manager.
 *    The version lookup uses a relative path so the copy also works from a sub-directory
 *    (GitHub Pages).
 *  - ./mod: the PolyRanked mod files, importing PolyTypes.js from the copy itself.
 *  - ./mods/<id>: the ported mods from ./mods (car models included; their checksums are
 *    verified against each version's assets.json).
 *  - main.bundle.js: the first-launch tutorial is replaced by a one-time prompt to visit the Garage
 *    and, when POLYRANKED_KODUB_PROXY=<url> is set, PolyTrack's backend
 *    (leaderboards, invite-code multiplayer) is reached through that proxy (see
 *    server/src/kodubproxy.js) because the official servers only accept known origins.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
const rankedEnabled = args.includes("--ranked-enabled") || /^(1|true|yes|on)$/i.test(process.env.POLYRANKED_RANKED_ENABLED ?? "");

/**
 * Mods the copy registers in every player's mod list. `__SELF__` is replaced at runtime with the
 * copy's own URL. `match` substrings (case-insensitive) recognise entries players already added
 * from elsewhere (e.g. the CDN URL of this repository) so nothing is registered twice.
 */
const BUILTIN_MODS = [
  { base: "__SELF__/mod", loaded: rankedEnabled, match: ["boosterfrank/polymultiplayer", "__SELF__/mod"] },
  { base: "https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist", loaded: true, match: ["prawnfoot05/polycup"] },
];
/**
 * Third-party mods ported to 0.6.3 in ./mods (see mods/README.md), served from the copy itself.
 * Order matters: Car Switcher must be imported before the car packs that depend on it. `match`
 * also recognises the upstream install URLs so a copy of the original mod is not registered twice.
 */
const PORTED_MODS = [
  { id: "carswitcher", match: ["orangyspolymods/main/carswitcher"] },
  { id: "coolcars", match: ["jakobspolymods/main/coolcars"] },
  { id: "goofycars", match: ["jakobspolymods/main/goofycars"] },
  { id: "husplits", match: ["orangyspolymods/main/husplits"] },
];
for (const m of PORTED_MODS) BUILTIN_MODS.push({ base: `__SELF__/mods/${m.id}`, loaded: true, match: [`__SELF__/mods/${m.id}`, ...m.match] });
const extraMods = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--extra-mod" && args[i + 1]) extraMods.push(args[++i]);
for (const m of (process.env.POLYRANKED_EXTRA_MODS ?? "").split(",")) if (m.trim()) extraMods.push(m.trim());
for (const spec of extraMods) {
  const [url, flag] = spec.split("=");
  const base = url.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error(`--extra-mod needs an http(s) URL: ${spec}`);
  BUILTIN_MODS.push({ base, loaded: !/^(off|false|0|disabled)$/i.test(flag ?? "on"), match: [base] });
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
}

function assertReplace(source, search, replacement, label) {
  const idx = source.indexOf(search);
  if (idx === -1) throw new Error(`patch anchor not found: ${label}`);
  if (source.indexOf(search, idx + 1) !== -1) throw new Error(`patch anchor is ambiguous: ${label}`);
  return source.slice(0, idx) + replacement + source.slice(idx + search.length);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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
const ensureBlock = `/* PolyRanked: built-in mods are always in the list (added once; players may still unload or remove them). */
        try {
            const polyRankedSelf = new URL(".", document.baseURI).href.replace(/\\/+$/, "");
            const polyRankedBuiltin = ${JSON.stringify(BUILTIN_MODS)};
            const polyRankedList = __classPrivateFieldGet(this, _PolyModLoaderImpl_polyModUrls, "f") || [];
            let polyRankedChanged = false;
            for (const builtin of polyRankedBuiltin) {
                const base = builtin.base.replace("__SELF__", polyRankedSelf);
                const keys = builtin.match.map((k) => k.replace("__SELF__", polyRankedSelf).toLowerCase());
                const present = polyRankedList.some((m) => m && typeof m.base === "string" && keys.some((k) => m.base.replace(/\\/+$/, "").toLowerCase().includes(k)));
                if (!present) {
                    polyRankedList.push({ "base": base, "version": "latest", "loaded": !!builtin.loaded });
                    polyRankedChanged = true;
                }
            }
            if (polyRankedChanged) {
                __classPrivateFieldSet(this, _PolyModLoaderImpl_polyModUrls, polyRankedList, "f");
                this.localStorage?.setItem("polyMods", JSON.stringify(polyRankedList));
            }
        }
        catch (polyRankedErr) {
            console.warn("[PolyRanked] could not register the built-in mods", polyRankedErr);
        }
        `;
loader = loader.slice(0, returnIdx) + ensureBlock + loader.slice(returnIdx);
fs.writeFileSync(loaderPath, loader);

// 4b. Patch the game bundle: no first-launch tutorial, optional backend proxy
const bundleGamePath = path.join(outDir, "main.bundle.js");
let game = fs.readFileSync(bundleGamePath, "utf8");
game = assertReplace(game, ': { type: "tutorial" };', ': { type: "polyranked-garage" }; /* PolyRanked: Garage prompt instead of the tutorial */', "tutorial startup action");
// In the main menu's startup switch, `s` = user profiles, `f` = popup manager, `m` = open the garage.
game = assertReplace(
  game,
  'case "tutorial": {',
  `case "polyranked-garage": {
                                  /* PolyRanked: the first-launch tutorial is replaced by a one-time Garage reminder */
                                  try {
                                    const polyRankedKey = "polyranked.garagePrompted";
                                    let polyRankedSeen = false;
                                    try { polyRankedSeen = !!localStorage.getItem(polyRankedKey); } catch (polyRankedErr) {}
                                    const polyRankedName = s.getCurrentUserProfile().nickname;
                                    if (!polyRankedSeen && (!polyRankedName || polyRankedName === "Anonymous")) {
                                      try { localStorage.setItem(polyRankedKey, "1"); } catch (polyRankedErr) {}
                                      f.showConfirm(
                                        "Welcome to PolyTrack!\\n\\nYou are playing as \\"Anonymous\\" with a random car. Visit the Garage to pick your nickname and car first \\u2013 other players will see them.",
                                        "Later",
                                        "Go to Garage",
                                        null,
                                        () => { m(); },
                                      );
                                    }
                                  } catch (polyRankedErr) {
                                    console.warn("[PolyRanked] garage prompt failed", polyRankedErr);
                                  }
                                  break;
                                }
                                case "tutorial": {`,
  "tutorial case",
);
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

// 5b. Ported mods: manifest + version folder (car models included) from ./mods/<id>, PolyTypes
//     from the copy; the models are checked against the checksums in assets.json
const portedInfo = {};
let assetBytes = 0;
for (const { id } of PORTED_MODS) {
  const src = path.join(root, "mods", id);
  const modManifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
  const version = modManifest.latest["0.6.3"];
  if (!version) throw new Error(`mods/${id}/manifest.json has no 0.6.3 version`);
  const dest = path.join(outDir, "mods", id, version);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(src, "manifest.json"), path.join(outDir, "mods", id, "manifest.json"));
  fs.cpSync(path.join(src, version), dest, { recursive: true });
  const mainFile = path.join(dest, JSON.parse(fs.readFileSync(path.join(src, version, "version.json"), "utf8")).main);
  fs.writeFileSync(mainFile, assertReplace(fs.readFileSync(mainFile, "utf8"), 'from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js"', 'from "../../../PolyTypes.js"', `${id} PolyTypes import`));
  const assetsFile = path.join(src, version, "assets.json");
  const assets = fs.existsSync(assetsFile) ? JSON.parse(fs.readFileSync(assetsFile, "utf8")) : { files: [] };
  for (const asset of assets.files) {
    const file = path.join(dest, "assets", asset.file);
    if (!fs.existsSync(file)) throw new Error(`mods/${id}/${version}/assets/${asset.file} is missing`);
    if (sha256File(file) !== asset.sha256) throw new Error(`mods/${id}/${version}/assets/${asset.file} does not match its checksum in assets.json`);
    assetBytes += fs.statSync(file).size;
  }
  portedInfo[id] = { version, assets: assets.files.length, upstream: assets.source ?? null };
}

// 6. Static-host niceties
fs.writeFileSync(path.join(outDir, ".nojekyll"), "");
fs.writeFileSync(
  path.join(outDir, "polyranked-site.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), pmlCommit: PML_COMMIT, modVersion, defaultServer: process.env.POLYRANKED_DEFAULT_SERVER ?? "wss://hydrogen-granted-distributors-pos.trycloudflare.com", kodubProxy: kodubProxy || null, tutorial: false, builtinMods: BUILTIN_MODS.map((m) => ({ base: m.base, loaded: m.loaded })), portedMods: portedInfo }, null, 2) + "\n",
);

let total = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : (total += fs.statSync(path.join(d, e.name)).size);
};
walk(outDir);
console.log(`[site] built ${path.relative(root, outDir)} (${(total / 1024 / 1024).toFixed(1)} MB, ${(assetBytes / 1024 / 1024).toFixed(0)} MB of car models): PolyModLoader ${PML_COMMIT.slice(0, 7)} + PolyRanked ${modVersion}, default server ${process.env.POLYRANKED_DEFAULT_SERVER ?? "wss://hydrogen-granted-distributors-pos.trycloudflare.com"}, tutorial off, ranked ${rankedEnabled ? "on" : "off"} by default, built-in mods: ${BUILTIN_MODS.map((m) => m.base.replace("__SELF__", ".")).join(" ")}${kodubProxy ? `, backend via ${kodubProxy} (${proxiedCalls} call sites)` : ""}`);
