# PolyRanked wire protocol (v1)

Transport: one WebSocket per player. Text frames carry JSON objects with a `type`
field; binary frames carry car states. All times are Unix milliseconds on the
**server clock** (clients estimate the offset from `ping`/`pong`). "frames" are
PolyTrack race-time frames, i.e. milliseconds.

## Client → server

| type | fields | notes |
| --- | --- | --- |
| `hello` | `protocol`, `secret`, `nickname`, `countryCode`, `carStyle`, `gameVersion`, `modVersion`, `vanilla` | must be first. `secret` identifies the player (`id = sha256(secret)`). |
| `queue_join` | `queue` | queue id from `welcome.queues` |
| `queue_leave` | | |
| `match_ready` | `matchId` | track loaded, connection created |
| `record` | `matchId`, `sessionId`, `frames` | a finished run (the game sends only session-best improvements) |
| `car_reset` | `matchId`, `sessionId`, `resetCounter` | the player restarted |
| `leave_match` | `matchId` | forfeit |
| `ping` | `t` | answered with `pong {t, serverTime}` |
| `leaderboard_get` | `queue` | |
| `cup_join` | `vanilla` | a seat in the always-on cup; answered with `match_found` (`format.cup = true`) |
| `cup_leave` | | (`leave_match` works too) |

Binary `CAR_UPDATE` (type byte `1`):
`u8 type | u32 sessionId | u32 resetCounter | u16 count | count × { u16 len, bytes }`.
Each `bytes` blob is a car state in the game's own multiplayer encoding
(`mod/src/carstate.js`). The server never decodes the blobs.

## Server → client

| type | fields |
| --- | --- |
| `welcome` | `playerId`, `serverTime`, `canQueue`, `queueReason`, `profile {nickname, ratings{queue: {rating, matches, wins, losses, division, label, …}}}`, `queues[]`, `rating {initial, placementMatches, divisions}` |
| `error` | `code`, `message` |
| `queue_status` | `queueId`, `waiting`, `required`, `waitedMs`, `inQueue` |
| `match_found` | `matchId`, `queueId`, `queueName`, `format {scoring, teams, teamSize, roundsToWin, maxRounds, pointsTable}`, `players[] {slot, id, nickname, countryCode, carStyle, team, rating, division}`, `track {id, name, trackUrl, trackCode, roundSeconds}`, `you` (your slot), `countdownSeconds`, `readyTimeoutSeconds` |
| `match_resume` | everything in `match_found` plus `phase`, `round`, `sessionId`, `startsAt`, `endsAt`, `scores`, `records`, `rounds` |
| `round_start` | `matchId`, `round`, `sessionId`, `track`, `startsAt`, `endsAt`, `countdownSeconds`, `scores`, `players` |
| `round_clock` | `sessionId`, `endsAt` (round shortened because everyone finished) |
| `records` | `sessionId`, `records {slot: frames}` |
| `round_end` | `round`, `sessionId`, `results[] {slot, frames, position, points}`, `roundWinner`, `teamPoints`, `scores`, `nextRoundIn`, `matchOver` |
| `match_end` | `winner`, `reason` (`rounds`, `max_rounds`, `draw`, `forfeit`), `scores`, `rounds[]`, `ratings {slot: {before, after, delta, division, result}}`, `players` |
| `player_left` | `slot`, `reason` (`left`, `timeout`, `disconnected`) |
| `player_status` | `slot`, `connected` |
| `pings` | `pings {slot: ms}` |
| `car_reset` | `sessionId`, `slot`, `resetCounter` |
| `server_message` | `text` (shown as an in-game toast) |
| `pong` | `t`, `serverTime` |
| `leaderboard` | `queue`, `entries[] {position, id, nickname, countryCode, rating, matches, wins, losses, division}` |
| `cup_state` | `cup` – the lobby: `{name, phase, cupNumber, round, trackRounds, roundsPerTrack, target, pointsTable, minPlayers, maxPlayers, track, players[], standings[] {slot, id, nickname, points, place, connected}, startsAt, endsAt, nextAt, lastWinner}` (sent to members on every change) |
| `cup_end` | `cupNumber`, `winner {slot, id, nickname, points}`, `standings[]`, `scores`, `rounds`, `nextCupIn`, `nextAt`, `nextTrack`, `players` |

### The always-on cup

The cup is a permanent lobby (`matchId = "cup"`) that reuses the match messages:
`cup_join` answers with `match_found` (`format = {scoring: "points", cup: true,
target, roundsPerTrack, pointsTable}`, plus the lobby in `cup`), the client loads
the track and sends `match_ready`; rounds then arrive as `round_start` /
`round_end` (with `cupOver` and, before a track change, `nextTrack` to preload)
whenever enough loaded racers are present. Players who join during a round take
part from the next one. A winner ends the cup with `cup_end`; after `nextCupIn`
the standings reset and the next cup's `round_start` follows by itself. `welcome`
carries the lobby as `cup` (or `null` when the server has none).

Binary `CAR_UPDATE_RELAY` (type byte `2`):
`u8 type | u8 slot | u32 sessionId | u32 resetCounter | u16 count | count × { u16 len, bytes }`.

`scores` is `{roundsPlayed, roundWins: [team0, team1] | null, points: {slot: total}}`.
`winner` / `roundWinner` are `{type: "team", team}` or `{type: "player", slot}` or `null`.

## Session ids

Every round is a new game session; `sessionId = (matchSeq << 8 | round) >>> 0`.
The game only ever compares session ids for equality.

## HTTP

`GET /health`, `GET /api/queues`, `GET /api/leaderboard?queue=duel&limit=50`,
`GET /api/stats`, `GET /api/cup` (the lobby, same shape as `cup_state.cup`, or
`{enabled: false}`), `GET /api/cup/leaderboard` (cup wins per player and the last
cups), and `GET /mod/*` when the server is started with `--serve-mod <dir>`.
