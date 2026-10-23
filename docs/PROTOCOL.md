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
| `cup_round_ready` | `sessionId`, `pb` | the game created its in-game state for the round's session (`pb`: the player's best on the track in frames, `null` for none, may be sent again when a better one is found) |
| `cup_warmup_ready` | `sessionId` | done practising; when every racer is ready the warmup ends |
| `cup_checkpoint` | `sessionId`, `index`, `frames` | live-round progress (round time at checkpoint `index`) |
| `cup_dnf` | `sessionId` | retire from the live round |

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
| `cup_state` | `cup` – the lobby: `{name, phase (idle, break, loading, warmup, countdown, racing, complete), cupNumber, round, trackRounds, roundsPerTrack, rules {target, points, finishTimeoutSeconds, roundBreakSeconds, warmup…, allowSpectatorFreecam, uploadLeaderboardTimes}, gameMode, minPlayers, maxPlayers, track {…, category, wr {status, frames, nickname, countryCode}, tr {frames, nickname, nicknames, playerId, countryCode, setAt, cupNumber} – the server's permanent cup record}, lastTrack, players[] {slot, id, nickname, countryCode, carStyle, connected, racing, pending, points, pb}, standings[] {slot, id, nickname, points, place, connected}, live {sessionId, racers[], ready[], warmup, warmupMs, warmupReady[], warmupEndsAt, startsAt, deadline, limitAt, finishes {slot: frames}, dnfs[], splits {slot: {index, frames, bestFrames}}, movement {slot: places}}, lastRound {round, trackId, finishes, points, dnfs, movement, results[]}, winner, nextAt, lastWinner, serverTime}` (sent to members on every change, including every checkpoint) |
| `cup_end` | `cupNumber`, `winner {slot, id, nickname, points}`, `standings[]`, `scores`, `rounds`, `nextCupIn`, `nextAt`, `nextTrack`, `players` |

### The always-on cup

The cup is a permanent lobby (`matchId = "cup"`) that reuses the match messages:
`cup_join` answers with `match_found` (`format = {scoring: "points", cup: true,
live: true, gameMode, target, roundsPerTrack, pointsTable}`, plus the lobby in
`cup`, and – while a round runs – its `phase` and `sessionId` so the newcomer can
watch it), the client loads
the track and sends `match_ready`; rounds then arrive as `round_start` /
`round_start` carries `warmup`, `warmupMs`, `gameMode`, `racers[]` and
`loadGraceMs` instead of a round clock (the schedule lives in `cup_state.live`:
`warmupEndsAt`, `startsAt`, `deadline`, `limitAt`); `round_end` (with `cupOver`
and, before a track change, `nextTrack` to preload)
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
cups), `GET /api/cup/records` (the permanent cup track records: `{records[]
{trackId, track, frames, playerId, nickname, countryCode, setAt, cupNumber,
round}}`), and `GET /mod/*` when the server is started with `--serve-mod <dir>`.
