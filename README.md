# PolyRanked – Trackmania-style ranked matchmaking for PolyTrack

PolyRanked is a [PolyModLoader](https://polymodloader.com) mod for **PolyTrack 0.6.3**
plus a small Node.js server. Players queue from the main menu, get matched by
rating, and race live rounds against each other on the same track – the opponents'
cars are rendered by the game's own multiplayer code. Matches follow Trackmania's
ranked format (rounds, first to N round wins, position points for teams/FFA) and
feed an Elo-style rating with divisions from Bronze to Trackmaster.

| | |
| --- | --- |
| Mod install URL (PML) | `https://cdn.polymodloader.com/gh/boosterfrank/polymultiplayer/main/` (any branch works: `…/polymultiplayer/<branch>/`) |
| Game version | PolyTrack 0.6.3 (PolyModLoader 0.6.3 builds) |
| Server | Node.js ≥ 18, one dependency (`ws`) |

## For players

1. Install PolyModLoader (web or app) – see the [PML wiki](https://wiki.polymodloader.com/for-users/).
2. Open the PML mod manager and add the install URL above (pick *latest*), move the
   mod to *Loaded*, reload the game.
3. Press **F7** in the main menu for the Ranked menu (the main-menu button is hidden for now); the always-on cup is on the *Multiplayer* page.
   Open *Settings* inside it and enter the address of a PolyRanked server
   (`wss://…`), then *Save*.
4. Pick a queue. When a match is found the track loads automatically, a countdown
   runs, and the round starts for everyone at the same time.

Ranked requires vanilla physics: the game's own determinism self-test must pass
and no PML mod may touch the physics (`touchingPhysics`), otherwise queueing is
refused.

### How a match works

* A round is a **time-attack window** on one track: drive as many attempts as you
  want, your best time counts, no finish = DNF. Once every player has finished at
  least once the window shrinks to 15 s.
* **Ranked 1v1** – the faster player wins the round; first to 4 round wins.
* **Ranked 3v3** – position points 6/5/4/3/2/1, team total wins the round
  (tie → better best time); first to 5 round wins, like Trackmania.
* **Ranked FFA** – 4 players, position points 10/6/4/3/2/1 over 5 rounds.
* Leaving the game state (Exit button, connection loss beyond a 20 s grace
  period) forfeits. Ratings are per queue; players are *Unranked* until 5
  placement matches are done.

### The always-on Quickplay Cup

Open **Multiplayer** in the main menu and the page carries a big **Join the Cup**
button with the live state of the cup (who is racing, which track, who leads).
The cup is one permanent lobby on the ranked server that plays like a
[PolyCup](https://github.com/Prawnfoot05/PolyCup) running the Quickplay preset:

* it never closes; join and leave whenever you like. Late joiners watch the
  running round from inside the session and race from the next one, leavers keep
  their points for a comeback;
* a random track from the main and community tracks every **4 rounds**. The
  first visit of a track starts with a **warmup** (1.4 x the world record, at
  least 30 s, 90 s without a known record); press **Ready** when you are done
  practising – when everyone is ready the countdown starts right away;
* rounds are **live**: 3-2-1-GO, everybody's clock starts at GO, one run.
  **R / Enter** returns you to the last checkpoint (before the first checkpoint
  it restarts the run, the round clock keeps counting), **T / Backspace**
  retires you from the round. Once somebody finishes the others have **10 s**;
* finished or retired? You watch the remaining racers with the game's chase
  camera (`[` / `]` switch racer, `/` the free camera); the panel shows the
  live **ROUND RANKING** with gaps, the world record and the cup's track record;
* places score **10/8/6/5/4/3/2/1**, the first racer at **120 points** with a
  unique lead wins the cup; after a short break the standings reset and the
  next cup starts automatically. Times set in the cup go to the normal
  leaderboards;
* it does not affect ranked ratings; cup wins have their own leaderboard
  (`/api/cup/leaderboard`).

The rules are a PolyCup preset: drop your `.polycup-preset.json` into the
server's `cup.presetFile` (or edit `cup.rules`, see `server/config.example.json`);
`"enabled": false` hides the button.

## Hosting a server

```bash
git clone https://github.com/boosterfrank/polymultiplayer
cd polymultiplayer/server
npm install
npm start                      # ws://0.0.0.0:8788
```

Configuration: copy `server/config.example.json` to `server/config.json` (or pass
`--config path.json`, or `POLYRANKED_CONFIG=…`). Everything is optional and
merged over the defaults in `server/src/config.js`:

* `queues` – enable/disable queues, change `roundsToWin`, `maxRounds`, `pointsTable`.
* `tracks` – the map pool. Each entry needs the game's track `id` plus a
  `trackUrl` (official/community tracks shipped with the game) or a `trackCode`
  (any exported track), a `tier` (1 = Bronze pool … 4 = Master pool) and
  `roundSeconds`. `server/tracks.community.json` lists all 70 community tracks of
  0.6.3 ready to paste in.
* `rounds` – countdown, finish grace, results time, reconnect grace.
* `rating` – initial rating, K factors, placement matches, division thresholds.
* `trackPerRound` – pick a new track every round instead of one per match.
* `gameVersion` / `requireVanillaPhysics` – gate who may queue (and join the cup).
* `cup` – the always-on Quickplay Cup: `rules` in the PolyCup preset format (or
  `presetFile`), the track categories it draws from, players needed, load and
  disconnect grace, the safety limit of a round, the break between cups, and
  `worldRecords` (fetched from PolyTrack's leaderboard with the PolyModLoader
  origin, for the warmup length and the WR line), or `"enabled": false`.

Players are stored in `data/polyranked.json` (atomic JSON writes). The HTTP side
exposes `/health`, `/api/queues`, `/api/leaderboard?queue=duel`, `/api/stats`.
Put the server behind a TLS-terminating reverse proxy (Caddy, nginx) so the mod
can connect with `wss://` from the HTTPS game page.

`docker build -t polyranked server && docker run -p 8788:8788 -v polyranked-data:/app/data polyranked`
also works (see `server/Dockerfile`).

## Your own game copy with PolyRanked built in

`tools/build-site.mjs` produces a self-contained copy of the PolyModLoader web
version (pinned to the 0.6.3 build this mod targets) in which the loader
registers a set of built-in mods in every player's mod list:

* **PolyRanked**, served from the copy itself, installed but **switched off by
  default** (players enable it under *Mods* in the main menu; build with
  `POLYRANKED_RANKED_ENABLED=1` or `--ranked-enabled` to ship it on);
* **PolyCup** (`https://cdn.polymodloader.com/gh/Prawnfoot05/PolyCup/main/dist`), on;
* **Car Switcher**, **Cool Cars** and **Goofy Cars**, ported to PolyTrack 0.6.3
  in [`mods/`](mods/README.md) and served from the copy, on. They add a
  *Select Car* button to the Garage with 26 car models (Orangy's Car Switcher
  cars plus CRJakob's two packs). They can also be installed on any
  PolyModLoader through the CDN, e.g.
  `https://cdn.polymodloader.com/gh/boosterfrank/polymultiplayer/main/mods/carswitcher`
  (then `.../mods/coolcars` and `.../mods/goofycars`);
* anything else you pass with `--extra-mod <url>[=off]` or `POLYRANKED_EXTRA_MODS`.

Each entry is added once; players can still unload or remove them.

A car only counts as a physics change when its collision model differs from the
vanilla car (the game checks that with a checksum), so with the usual cars
PolyModLoader keeps reporting vanilla physics and ranked play stays available.
Custom engine sounds (Pingu, Minecart) need the PML API mod; add it with
`--extra-mod https://cdn.polymodloader.com/pml/PolyModLoader/pmlapi/dist` if
you want them.

Publishing it on GitHub Pages (free, stable URL):

1. In the repository settings open *Pages* and set *Source* to **GitHub Actions**.
2. Optional: under *Secrets and variables → Actions → Variables* add
   `POLYRANKED_SERVER` = `wss://your-server` so the copy connects to your server
   by default.
3. Push to `main` (or run the *Deploy game copy to GitHub Pages* workflow). The
   game is then available at `https://<your-user>.github.io/polymultiplayer/`.

Building it yourself: `POLYRANKED_DEFAULT_SERVER=wss://… npm run build:site`
writes `dist/site/`, which any static host can serve (for example
`npx http-server dist/site` on the Pi behind the same Cloudflare tunnel).
`npm run e2e:site` smoke-tests a build in headless Chromium.

The copy skips PolyTrack's first-launch tutorial; instead new players (nickname
still "Anonymous") are asked once to visit the Garage and pick a nickname and
car. The prompt is built into the copy, so it works even with PolyRanked off.

### Leaderboards and the game's own multiplayer on the copy

PolyTrack's servers (leaderboards, the invite-code multiplayer) only answer
requests coming from known hosts, so on a self-hosted copy creating an invite
fails. The ranked server can forward those requests with the `Origin` header the
PolyModLoader desktop app uses:

1. In `server/config.json` set `"kodubProxy": { "enabled": true }` and restart
   the server; `/health` then shows a `kodubProxy` section with request counts
   and the last upstream error (for example `upstream rejected websocket
   /v6/multiplayer/host with HTTP 403`), which tells you whether Kodub's server
   accepted the configured `origin`.
2. Build the copy with `POLYRANKED_KODUB_PROXY=https://your-server/kodub`
   (GitHub Pages: Actions variable `POLYRANKED_KODUB_PROXY`). Every
   `vps.kodub.com` call in the game bundle is rewritten to that URL.

This is the same header rewrite PolyModLoader's own app and PolyProxy mod do,
but it is still a workaround for a restriction Kodub put in place: use it for a
private group, not for a public mirror. Keep in mind that, exactly like
PolyModLoader itself, the copy redistributes PolyTrack's game files, which belong
to Kodub.

## Development

```bash
npm install                    # esbuild for the mod bundle
npm run build                  # mod/src → 0.3.0/main.mod.js (+ POLYRANKED_DEFAULT_SERVER=wss://… to bake a default)
npm test                       # mod unit tests + server tests (rules, rating, matchmaking, match engine, sockets)
npm run dev                    # build, then run the server and serve the mod at http://localhost:8788/mod/
npm run build:site             # self-contained PolyModLoader copy with the mod pre-installed -> dist/site/
```

For local testing add `http://localhost:8788/mod` as the mod URL in PML (PML does
not cache localhost mods). `node test/e2e/run.mjs --game-dir <PolyModLoader checkout>`
runs a headless Chromium end-to-end match using the real game build, and
`node test/e2e/cup.mjs` does the same for the always-on cup (warmup, ready-up,
GO, finish window, retiring, spectating, a cup win and the automatic restart;
see the file headers for details).

Repository layout, the game-hooking approach and the ranked rules are described
in [docs/DESIGN.md](docs/DESIGN.md); the message format in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Credits

PolyTrack is made by [Kodub](https://www.kodub.com). PolyModLoader is a
community project; this mod only uses its public API and the game's own
multiplayer plumbing. PolyRanked is not affiliated with either.

The game copy bundles ports of **Car Switcher** by Orangy and **Cool Cars** /
**Goofy Cars** by CRJakob (see [mods/README.md](mods/README.md) for the sources,
what the ports change and the licensing situation).
