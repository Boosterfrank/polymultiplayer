#!/usr/bin/env node
// Bundles mod/src into the PML version folder declared in manifest.json.
import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const gameVersion = "0.6.3";
const modVersion = manifest.latest[gameVersion];
if (!modVersion) throw new Error(`manifest.json has no version for PolyTrack ${gameVersion}`);
const outdir = path.join(root, modVersion);
fs.mkdirSync(outdir, { recursive: true });

const defaultServer = process.env.POLYRANKED_DEFAULT_SERVER ?? "ws://localhost:8788";

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: [path.join(root, "mod/src/main.js")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  platform: "browser",
  outfile: path.join(outdir, "main.mod.js"),
  external: ["https://*"],
  legalComments: "none",
  minify: false,
  sourcemap: false,
  define: {
    __POLYRANKED_DEFAULT_SERVER__: JSON.stringify(defaultServer),
    __POLYRANKED_VERSION__: JSON.stringify(modVersion),
  },
  banner: {
    js: `// PolyRanked ${modVersion} – https://github.com/boosterfrank/polymultiplayer (built ${new Date().toISOString().slice(0, 10)})`,
  },
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`[build] watching, output: ${options.outfile}`);
} else {
  await build(options);
  const size = fs.statSync(options.outfile).size;
  console.log(`[build] ${path.relative(root, options.outfile)} (${(size / 1024).toFixed(1)} kB, default server ${defaultServer})`);
}
