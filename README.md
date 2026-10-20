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
3. A **Ranked** button appears next to *Multiplayer* in the main menu (shortcut: F7).
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
* `gameVersion` / `requireVanillaPhysics` – gate who may queue.

Players are stored in `data/polyranked.json` (atomic JSON writes). The HTTP side
exposes `/health`, `/api/queues`, `/api/leaderboard?queue=duel`, `/api/stats`.
Put the server behind a TLS-terminating reverse proxy (Caddy, nginx) so the mod
can connect with `wss://` from the HTTPS game page.

`docker build -t polyranked server && docker run -p 8788:8788 -v polyranked-data:/app/data polyranked`
also works (see `server/Dockerfile`).

## Development

```bash
npm install                    # esbuild for the mod bundle
npm run build                  # mod/src → 0.1.0/main.mod.js (+ POLYRANKED_DEFAULT_SERVER=wss://… to bake a default)
npm test                       # mod unit tests + server tests (rules, rating, matchmaking, match engine, sockets)
npm run dev                    # build, then run the server and serve the mod at http://localhost:8788/mod/
```

For local testing add `http://localhost:8788/mod` as the mod URL in PML (PML does
not cache localhost mods). `node test/e2e/run.mjs --game-dir <PolyModLoader checkout>`
runs a headless Chromium end-to-end match using the real game build (see the
file header for details).

Repository layout, the game-hooking approach and the ranked rules are described
in [docs/DESIGN.md](docs/DESIGN.md); the message format in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Credits

PolyTrack is made by [Kodub](https://www.kodub.com). PolyModLoader is a
community project; this mod only uses its public API and the game's own
multiplayer plumbing. PolyRanked is not affiliated with either.
