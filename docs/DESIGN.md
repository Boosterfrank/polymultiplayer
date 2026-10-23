# PolyRanked – design

PolyRanked is a [PolyModLoader](https://polymodloader.com) (PML) mod plus a small
server that adds **Trackmania-style ranked matchmaking** to PolyTrack 0.6.3.

```
┌──────────────┐   WebSocket (JSON + binary car states)   ┌─────────────────────┐
│ PolyTrack +  │ ───────────────────────────────────────► │ PolyRanked server   │
│ PML + mod    │ ◄─────────────────────────────────────── │ (Node.js, `ws`)     │
└──────────────┘                                          └─────────────────────┘
   mod/  (client)                                            server/
```

## How the mod hooks the game

PolyTrack 0.6.0+ ships an experimental multiplayer mode. Internally the in-game
state class (`Is` in the 0.6.3 bundle) does **not** know anything about WebRTC:
it receives a `multiplayerConnection` object and talks to it through a small
interface:

| method | purpose |
| --- | --- |
| `getPlayers()` | `[{id, nickname, countryCode, carStyle, record, isSelf}]` – drives remote car creation, name tags, the Players list and the Session Results screen |
| `addCarUpdateCallback(cb)` / `addCarResetCallback(cb)` | remote car states (`cb(sessionId, playerId, resetCounter, carState)`) |
| `addEndSessionCallback(sessionId, cb)` | the game freezes the car and shows "Session Results" |
| `addNewSessionCallback(sessionId, cb)` | `cb(sessionId, gameMode, trackMetadata, trackData)` – the game restarts itself on the next track |
| `addPlayersChangedCallback`, `addServerMessageCallback`, `addConnectionLostCallback` | UI refresh, toast messages, "Lost connection to server" |
| `sendCarUpdate(sessionId, resetCounter, carState)` / `sendCarReset` / `sendRecord(sessionId, time)` | our car and our finished times |
| `getMaxPlayers()`, `getPing(id)`, `isInviteAllowed()`, `dispose()` | misc |

`mod/src/connection.js` implements exactly this interface (`RankedConnection`)
on top of our WebSocket client. Because the connection is *not* an instance of
the game's host class, host-only UI (invite, kick, change track) is hidden
automatically.

A match is started with the game's own "start game" routine. That routine is a
local closure (`J`) inside the game's init function, so during `preInit` the mod
registers a PML **global mixin** that inserts a few lines right after PML's own
`ActivePolyModLoader.postInitMods();` call. The inserted code publishes the
closures the mod needs (`startGame`, `backToMenu`, the current state, popups,
profiles, the track registry) on `window.__polyRankedBridge`. Everything else
(`Is`, the time class, the track codec, the car-style codec, the game-mode
enum) is read with `pml.getFromPolyTrack(...)`.

Each ranked **round is one game session** in the game's *Competitive* mode:

1. `round_start` → `RankedConnection` fires the new-session callbacks → the game
   loads the track and creates a fresh in-game state.
2. While the server-synchronised countdown runs, the mod keeps the game's modal
   popup open (`popups.showNoButtons`), which the game already treats as
   "controls disabled". At *GO* the popup is hidden.
3. Players drive. Car states are batched every 100 ms and relayed by the server.
   Finishing calls `sendRecord` → `record` message → the server keeps the best
   time per player for the round and broadcasts `records`.
4. `round_end` → end-session callbacks → the game shows *Session Results*
   (ordered by `record`), the mod's HUD shows points / score.
5. Repeat until the match is decided → `match_end` → the mod shows the summary
   with rating changes and *Back to menu* / *Queue again*.

Leaving the game state (Exit button, lost connection) calls `dispose()` on the
connection, which the mod treats as *forfeit*.

## Ranked rules (Trackmania-inspired)

Rounds are **time-attack windows**: everybody races the same track at the same
time, as many attempts as they like, the best time of the window counts, no
finish = DNF. When every active player has finished at least once the window is
shortened to `finishGraceSeconds`.

| queue | players | round scoring | match |
| --- | --- | --- | --- |
| `duel` – Ranked 1v1 | 2 | faster time wins the round | first to `roundsToWin` (default 4) |
| `teams` – Ranked 3v3 | 6 (3v3) | position points 6/5/4/3/2/1 (only the best *k* players of each team count, *k* = size of the smaller team); higher team total wins, tie → better best time | first to 5 round wins (TM rule) |
| `ffa` – Ranked FFA | 4 (min 3) | position points 10/6/4/3/2/1 | most points after `maxRounds` (5) |

Teams are balanced with a snake draft on rating. The track is picked from the
pool allowed for the **lowest-rated player's division** (TM rule): Bronze →
tier 1, Silver → tier ≤ 2, Gold → ≤ 3, Master+ → all tiers.

## The always-on Quickplay Cup

Besides ranked matches the server keeps one permanent lobby (`server/src/cup.js`,
config `cup`) that follows PolyCup's rules (`cup.rules` is a PolyCup preset). It
never closes: players join and leave whenever they like from a *Join the Cup* box
on the game's own multiplayer page. Phases: `idle` → `break` (`roundBreakSeconds`)
→ `loading` (`round_start`; every racer's game reports `cup_round_ready`, late ones
sit the round out after `loadGraceSeconds`) → `warmup` (first visit of a track:
WR × `warmupMultiplier`, at least `warmupMinimumSeconds`, `warmupSeconds` without a
WR; `cup_warmup_ready` from everyone ends it early) → `countdown` (3 s) → `racing`
→ `break` … until someone is at `pointsToWin` with a unique lead → `complete`
(`breakSeconds`) → reset.

A live round: everybody's clock starts at `startsAt` (GO). Clients report
`cup_checkpoint` (index + round time) and the finish (`record`, first one counts,
validated against the time since GO); the first finish sets the deadline
`finish + finishTimeoutSeconds`, `cup_dnf` retires, and a round nobody finishes
ends at the `roundLimit` safety net. Places score `points` (10/8/6/5/4/3/2/1, DNF
0, exact ties share), the cup's track record (TR) and the live ranking (finishers
by time, then checkpoint progress with ▲/▼ movement, DNF last –
`shared/cupstandings.js`) are part of every `cup_state`. Late joiners are
`pending`: they get the running session (`match_found` with `phase`/`sessionId`)
and watch it, racing from the next round at zero points; leavers keep their points
for a comeback until the lobby has been empty for `idleResetSeconds`. World
records come from PolyTrack's leaderboard (`server/src/worldrecords.js`, with the
PolyModLoader desktop origin, cached). The cup does not touch ratings; wins are
counted separately (`GET /api/cup/leaderboard`).

On the client (`mod/src/cup/controller.js`, `mod/src/game.js`) the round is one
game session started with `startGame` directly so the track category is right
(uploads to the leaderboard count as verified). The game's own control gate and
restart routine are wrapped: controls are held until GO, `car.start()` runs the
clock from GO, the restart key retires (`cup_dnf`), a checkpoint reset before the
first checkpoint restarts the run with the time spent so far added to every
report (`timeOffset`), and the warmup leaves restarts to the game. Finished,
retired and pending players follow another racer's car with that car's own orbit
camera (the game only updates the local car's cameras, so the mod updates the
watched one), or the game's free camera. The overlay (`mod/src/cup/hud.js`) is
laid out like PolyCup's: track/round/phase, WR and TR strips, ROUND RANKING / CUP
STANDINGS, the finish-window timer, the 3-2-1-GO cue, warmup controls, the
spectator selector with the watched racer's PB, and the "retire" wording in the
game's own reset hint.

## Rating

Per-queue Elo. `K = 40` for the first `placementMatches` (5), then `20`.

* duel: classic Elo.
* teams: team rating = mean; `delta = K·(S − E)`; the delta is scaled by the
  player's share of the team's points (good performers gain more / lose less),
  in the spirit of Trackmania's "+40/+30/+20 by position".
* ffa: pairwise Elo (every pair of players is a mini match, divided by n−1).

Divisions (configurable): Bronze I–III, Silver I–III, Gold I–III, Master I–III,
Trackmaster. Players are *Unranked* until their placement matches are done.

## Identity & anti-abuse

The mod generates a random secret (localStorage) and sends it in `hello`; the
server identifies the player by `sha256(secret)`. Nickname, country and car
style come from the player's PolyTrack profile. Queueing is refused when PML
reports physics-touching mods (`pml.isVanillaCompatible()`), the game's
physics determinism self-test failed, or the game/mod version does not match the
server. Records are sanity-checked (positive, inside the round window, one
session). Everything else client-side is trusted – it is a browser game mod.

## Repository layout

```
manifest.json, 0.3.3/        PML install layout (install URL = repo root)
mod/src/                     mod source (bundled with esbuild into 0.3.3/main.mod.js)
mod/src/cup/, mod/src/game.js   the cup on the client: round flow, game hooks, PolyCup-style HUD
mod/src/splits.js, mod/src/ui/splits.js   Trackmania-style checkpoint splits (cup_split from the server, else the fastest ghost)
shared/protocol.js           message names + binary framing shared by mod and server
shared/cupstandings.js       cup ranking (live race order, places, movement) shared by server and HUD
server/                      Node.js server (`npm start`), tests (`npm test`)
mods/                        third-party mods ported to 0.6.3 for the game copy (see mods/README.md)
tools/build-site.mjs         builds the self-contained game copy with all built-in mods
test/e2e/                    headless-Chromium tests against the real game build (ranked match, cup, site smoke)
docs/                        this file, PROTOCOL.md
```
