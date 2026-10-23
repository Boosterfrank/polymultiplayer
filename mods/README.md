# Ported mods

Third-party PolyModLoader mods ported to PolyTrack 0.6.3 and bundled with the game
copy (`tools/build-site.mjs` serves them from `./mods/<id>` and registers them as
built-in mods). Each folder uses the PolyModLoader 0.6.3 layout: `manifest.json`
with `latest["0.6.3"]`, and a version folder with `version.json`, `main.mod.js`,
`description.html`, `icon.png` and an `assets.json`.

| Mod | Port | Upstream | Written for |
| --- | --- | --- | --- |
| Car Switcher (`carswitcher`) | 1.0.8 | Orangy, [OrangysPolyMods](https://github.com/0rangy/OrangysPolyMods) `carswitcher/1.0.7` @ `2ecd49e` | PolyTrack 0.6.2 |
| Cool Cars (`coolcars`) | 1.0.5 | CRJakob, [jakobspolymods](https://github.com/CRJakob/jakobspolymods) `coolcars/1.0.4` @ `b3ae155` | PolyTrack 0.5.1 |
| Goofy Cars (`goofycars`) | 1.0.9 | CRJakob, [jakobspolymods](https://github.com/CRJakob/jakobspolymods) `goofycars/1.0.8` @ `b3ae155` | PolyTrack 0.5.1 |
| Heads Up Splits (`husplits`) | 2.1.4 | Orangy, [OrangysPolyMods](https://github.com/0rangy/OrangysPolyMods) `husplits/2.1.3` @ `2ecd49e` | PolyTrack 0.6.2 |

The GitHub repositories are mirrors of the authors' Codeberg repositories
(`https://codeberg.org/CRJakob/jakobspolymods`, which the PolyModLoader CDN serves
as `https://cdn.polymodloader.com/cb/CRJakob/jakobspolymods/main/coolcars`).

## Car models

The `.glb` car models (about 260 MB in total, one of them 96 MB) are stored
unchanged in each version's `assets/` folder so the mods can be installed on any
PolyModLoader straight from this repository through the CDN:

* `https://cdn.polymodloader.com/gh/boosterfrank/polymultiplayer/main/mods/carswitcher`
* `https://cdn.polymodloader.com/gh/boosterfrank/polymultiplayer/main/mods/coolcars`
* `https://cdn.polymodloader.com/gh/boosterfrank/polymultiplayer/main/mods/goofycars`
* `https://cdn.polymodloader.com/gh/boosterfrank/polymultiplayer/main/mods/husplits`

(Car Switcher first; the car packs depend on it. Heads Up Splits has no assets.) `assets.json` next to them
records where each file came from (repository, commit, path) and its SHA-256;
`tools/build-site.mjs` verifies the checksums when building the game copy.

## What the ports change

**Car Switcher** (`mods/carswitcher/1.0.8/main.mod.js`)

* 0.6.3 mod layout and PolyTypes import; webpack module ids (car module, GLTF
  and Draco loaders) are found by content with the 0.6.3 ids as fallback.
* The *Select Car* button is added by watching the UI for the Garage screen
  (`.customization-ui`) instead of a chunk mixin on `604.bundle.js`:
  PolyModLoader only applies one chunk mixin per bundle, and the markup is more
  stable than minified tokens. The car list is a panel inside the Garage with
  click handlers (no inline `onclick` strings, no `window.polyModLoader` global).
* The saved car (`localStorage.MyCar`, same key as upstream) is applied after the
  game has loaded instead of replacing `"models/car.glb"` at start-up, so a car
  that fails to download no longer stalls the loading screen.
* Models made for PolyTrack 0.5 (one `WheelFR/FL/BR/BL` mesh each, no `Wheel0-11`
  rim styles, no `Exhaust0-7`) load as well: their wheel mesh is used for every
  rim style, the vanilla exhausts fill in, and their wheel positions are derived
  from the wheel nodes (mirrored x, symmetrised, 0.6 wheel height) when they look
  plausible. Upstream 1.0.7 rejects such models (`Mesh "Wheel0" does not exist`).
* `touchingPhysics` is only set while a car with a non-vanilla collision model is
  active. The game verifies the collision hull with a SHA-256 checksum; the
  meshes and wheel positions are only used for rendering and audio (the physics
  worker has its own constants), so cosmetic cars keep PolyModLoader's
  "vanilla physics" status and PolyRanked keeps working. The mod exposes
  `activeCar`, `touchingPhysics` and `physicsReason` for other mods.
* Engine sounds still go through the PML API mod when it is installed
  (`pmlapi`, optional); without it the model changes and the sound stays.

**Cool Cars / Goofy Cars**: 0.6.3 layout, dependency `carswitcher ^1.0.2`, the
non-existent `audio/engine.flac` replaced by the game's `audio/engine.mp3`; the
car lists are unchanged.

**Heads Up Splits** (`mods/husplits/2.1.4/main.mod.js`): the mod inserts a
checkpoint callback into the routine that creates the player's car and compares
the split with the fastest ghost. Only the minified names changed between 0.6.2
and 0.6.3: that routine is `Es` (was `gs`), the ghost getter is
`(0, R.gn)(this, ta, "m", _s)` (was `jr` / `As`) and the time formatter is `He.A`
(was `Ve.A`); the insertion token, the settings and the UI are unchanged.

## Licensing

Neither upstream repository carries a license file, so the code and models are
redistributed here with attribution and without a license grant from their
authors. If you are one of the authors and want the port or the models removed,
open an issue in this repository.
