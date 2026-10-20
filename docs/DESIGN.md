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
manifest.json, 0.1.0/        PML install layout (install URL = repo root)
mod/src/                     mod source (bundled with esbuild into 0.1.0/main.mod.js)
shared/protocol.js           message names + binary framing shared by mod and server
server/                      Node.js server (`npm start`), tests (`npm test`)
docs/                        this file, PROTOCOL.md
```
