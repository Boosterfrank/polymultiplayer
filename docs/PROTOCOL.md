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

Binary `CAR_UPDATE_RELAY` (type byte `2`):
`u8 type | u8 slot | u32 sessionId | u32 resetCounter | u16 count | count × { u16 len, bytes }`.

`scores` is `{roundsPlayed, roundWins: [team0, team1] | null, points: {slot: total}}`.
`winner` / `roundWinner` are `{type: "team", team}` or `{type: "player", slot}` or `null`.

## Session ids

Every round is a new game session; `sessionId = (matchSeq << 8 | round) >>> 0`.
The game only ever compares session ids for equality.

## HTTP

`GET /health`, `GET /api/queues`, `GET /api/leaderboard?queue=duel&limit=50`,
`GET /api/stats`, and `GET /mod/*` when the server is started with `--serve-mod <dir>`.
