import { MSG } from "../../shared/protocol.js";
import { RankedConnection } from "./connection.js";
import { resolveTrack } from "./tracks.js";
import { Emitter, log, safe } from "./util.js";

/**
 * Drives one ranked match on the client: loads the track, hands the game a RankedConnection,
 * keeps the countdown gate, mirrors server events into the game and the HUD.
 *
 * Messages of the always-on cup (match_found with `format.cup`) are the CupController's.
 *
 * Events: "started" (match info), "ended" ({matchEnd}), "left", "queueAgain", "error" (text)
 */
export class MatchController extends Emitter {
  constructor({ client, bridge, game, hud, popups }) {
    super();
    this.client = client;
    this.bridge = bridge;
    this.game = game;
    this.hud = hud;
    this.popups = popups ?? bridge.popups;
    this.match = null; // current match info (from match_found / match_resume)
    this.connection = null;
    this.track = null;
    this.round = 0;
    this.sessionId = null;
    this.startsAt = 0;
    this.endsAt = 0;
    this.phase = "idle";
    this.gameStarted = false;
    this.countdownOpen = false;
    this._countdownTimer = null;
    this.matchEnd = null;
    this.prefetched = null; // {id, track} loaded ahead of a track change
    this._unsubs = [];
    this.listen();
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs = [];
    this.stopCountdown();
  }

  get active() {
    return this.match != null && this.phase !== "finished";
  }

  listen() {
    const on = (type, fn) => this._unsubs.push(this.client.on(type, (msg) => safe(() => fn(msg), type)));
    on(MSG.MATCH_FOUND, (msg) => this.onMatchFound(msg));
    on(MSG.MATCH_RESUME, (msg) => this.onMatchResume(msg));
    on(MSG.ROUND_START, (msg) => this.onRoundStart(msg));
    on(MSG.ROUND_CLOCK, (msg) => this.onRoundClock(msg));
    on(MSG.RECORDS, (msg) => this.onRecords(msg));
    on(MSG.ROUND_END, (msg) => this.onRoundEnd(msg));
    on(MSG.MATCH_END, (msg) => this.onMatchEnd(msg));
    on(MSG.PLAYER_LEFT, (msg) => this.onPlayerLeft(msg));
    on(MSG.PLAYER_STATUS, (msg) => this.onPlayerStatus(msg));
    on(MSG.PINGS, (msg) => this.connection?.setPings(msg.pings));
    on(MSG.CAR_RESET, (msg) => this.connection?.handleCarReset(msg.sessionId, msg.slot, msg.resetCounter));
    on(MSG.SERVER_MESSAGE, (msg) => this.connection?.serverMessage(msg.text));
    this._unsubs.push(this.client.on("binary", (bytes) => this.connection?.handleRelay(bytes)));
    this._unsubs.push(
      this.client.on("state", ({ state }) => {
        if (state === "disconnected" && this.active && this.connection) {
          // The game shows "Lost connection to server" and returns to the menu; we may resume on reconnect.
          this.hud.showToast("Connection lost – trying to reconnect…", 6000);
        }
      }),
    );
  }

  isSameMatch(msg) {
    return this.match && msg.matchId === this.match.matchId;
  }

  // ------------------------------------------------------------- match found / resume

  async onMatchFound(msg) {
    if (msg.format?.cup) return;
    if (this.active && this.match.matchId !== msg.matchId) {
      log.warn("received a new match while one is active; abandoning the old one");
      this.cleanup();
    }
    this.match = msg;
    this.matchEnd = null;
    this.phase = "loading";
    this.round = 0;
    this.gameStarted = false;
    this.hud.show(msg, msg.you);
    this.emit("started", msg);
    try {
      this.track = await resolveTrack(this.bridge, this.game, msg.track);
    } catch (err) {
      log.error("failed to load the match track", err);
      this.emit("error", `Could not load track "${msg.track?.name ?? "?"}": ${err.message}`);
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: msg.matchId });
      this.cleanup();
      return;
    }
    if (this.match !== msg) return; // left while loading
    this.connection = this.createConnection(msg);
    this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
  }

  async onMatchResume(msg) {
    if (msg.format?.cup) return;
    log.info("resuming match", msg.matchId, "phase", msg.phase);
    this.cleanup({ keepHud: false });
    this.match = msg;
    this.matchEnd = null;
    this.phase = msg.phase === "finished" ? "finished" : "loading";
    this.hud.show(msg, msg.you);
    try {
      this.track = await resolveTrack(this.bridge, this.game, msg.track);
    } catch (err) {
      this.emit("error", `Could not load track: ${err.message}`);
      this.cleanup();
      return;
    }
    if (this.match !== msg) return;
    this.connection = this.createConnection(msg);
    if (msg.phase === "finished") return;
    if (msg.round > 0) {
      this.onRoundStart({ matchId: msg.matchId, round: msg.round, sessionId: msg.sessionId, track: msg.track, startsAt: msg.startsAt, endsAt: msg.endsAt, scores: msg.scores, players: msg.players });
      if (msg.phase === "results" || msg.phase === "closing") this.connection.endSession(msg.sessionId);
      if (msg.records) this.onRecords({ matchId: msg.matchId, sessionId: msg.sessionId, records: msg.records });
    } else {
      this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
    }
  }

  createConnection(msg) {
    const connection = new RankedConnection({
      client: this.client,
      matchSlot: msg.you,
      players: msg.players,
      carStyleCodec: this.game.CarStyle ?? this.carStyleClassFromProfile(),
      gameMode: this.game.competitiveMode,
      onDispose: () => this.onConnectionDisposed(connection),
      onAttached: (sessionId) => this.onStateAttached(sessionId),
    });
    return connection;
  }

  carStyleClassFromProfile() {
    try {
      return this.bridge.profiles.getCurrentUserProfile().carStyle.constructor;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- rounds

  async onRoundStart(msg) {
    if (!this.isSameMatch(msg) || !this.connection) return;
    this.round = msg.round;
    this.sessionId = msg.sessionId;
    this.startsAt = msg.startsAt;
    this.endsAt = msg.endsAt;
    this.phase = "countdown";
    if (msg.players) this.connection.setPlayers(msg.players);
    this.hud.setPlayers(msg.players ?? this.match.players);
    this.hud.setRound(msg.round, msg.startsAt, msg.endsAt, msg.scores);

    if (msg.track && this.track && msg.track.id !== this.match.track?.id) {
      try {
        this.track = this.prefetched?.id === msg.track.id ? this.prefetched.track : await resolveTrack(this.bridge, this.game, msg.track);
        this.prefetched = null;
        this.match.track = msg.track;
      } catch (err) {
        log.error("failed to load the round track", err);
      }
    }
    if (this.sessionId !== msg.sessionId || !this.connection) return; // superseded while loading
    // Tell the game about the new session. If the in-game state already exists it restarts
    // itself through its new-session callback; otherwise we start the game ourselves.
    this.connection.startSession(msg.sessionId, this.track);
    if (!this.gameStarted) this.startGame();
  }

  startGame() {
    const info = { multiplayerConnection: this.connection, sessionId: this.sessionId, gameMode: this.game.competitiveMode };
    try {
      this.bridge.startGame(this.track.trackMetadata, this.track.trackData, "custom", [], info, false);
      this.gameStarted = true;
    } catch (err) {
      log.error("failed to start the game", err);
      this.emit("error", `Could not start the match: ${err.message}`);
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.cleanup();
    }
  }

  /** The game created its in-game state for `sessionId`; run the countdown gate. */
  onStateAttached(sessionId) {
    if (sessionId !== this.sessionId) return;
    this.runCountdown();
  }

  runCountdown() {
    this.stopCountdown();
    const tick = () => {
      if (!this.active || this.phase !== "countdown") return this.stopCountdown();
      const left = this.startsAt - this.client.serverNow();
      if (left <= 0) {
        this.phase = "racing";
        this.stopCountdown();
        this.hud.showToast("GO!", 1500);
        return;
      }
      const secs = Math.ceil(left / 1000);
      const text = `Round ${this.round} starts in ${secs}`;
      try {
        this.popups.showNoButtons(text);
        this.countdownOpen = true;
      } catch (err) {
        log.warn("countdown popup failed", err);
      }
      this._countdownTimer = setTimeout(tick, Math.min(250, left));
    };
    tick();
  }

  stopCountdown() {
    if (this._countdownTimer) clearTimeout(this._countdownTimer);
    this._countdownTimer = null;
    if (this.countdownOpen) {
      this.countdownOpen = false;
      safe(() => this.popups.hide(), "popups.hide");
    }
  }

  onRoundClock(msg) {
    if (!this.isSameMatch(msg) || msg.sessionId !== this.sessionId) return;
    this.endsAt = msg.endsAt;
    this.hud.setEndsAt(msg.endsAt);
  }

  onRecords(msg) {
    if (!this.isSameMatch(msg) || msg.sessionId !== this.sessionId) return;
    this.connection?.setRecords(msg.records ?? {});
    this.hud.setRecords(msg.records ?? {});
  }

  onRoundEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.phase = msg.matchOver ? "finished" : "results";
    this.stopCountdown();
    if (msg.nextTrack) this.prefetchTrack(msg.nextTrack);
    const records = {};
    for (const r of msg.results ?? []) if (r.frames != null) records[r.slot] = r.frames;
    this.connection?.setRecords(records);
    this.connection?.endSession(msg.sessionId);
    this.hud.setRecords(records);
    this.hud.setScores(msg.scores);
    const myPoints = msg.results?.find((r) => r.slot === this.match.you)?.points ?? 0;
    let text;
    if (msg.roundWinner?.type === "team") {
      const myTeam = this.match.players.find((p) => p.slot === this.match.you)?.team;
      text = msg.roundWinner.team === myTeam ? `Round ${msg.round} won!` : `Round ${msg.round} lost`;
    } else if (msg.roundWinner?.type === "player") {
      const name = this.match.players.find((p) => p.slot === msg.roundWinner.slot)?.nickname ?? "?";
      text = msg.roundWinner.slot === this.match.you ? `You won round ${msg.round}!` : `${name} won round ${msg.round}`;
    } else text = `Round ${msg.round}: draw`;
    if (this.match.format.scoring !== "duel") text += ` (+${myPoints})`;
    this.hud.showToast(text, msg.nextRoundIn ? msg.nextRoundIn : 6000);
  }

  prefetchTrack(info) {
    if (!info?.id || this.prefetched?.id === info.id) return;
    resolveTrack(this.bridge, this.game, info)
      .then((track) => {
        this.prefetched = { id: info.id, track };
      })
      .catch((err) => log.warn("could not preload the next track", err));
  }

  onMatchEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.phase = "finished";
    this.matchEnd = msg;
    this.stopCountdown();
    this.connection?.endSession(this.sessionId);
    this.hud.setScores(msg.scores);
    this.hud.showMatchEnd(msg, {
      onBackToMenu: () => this.leaveToMenu(false),
      onQueueAgain: () => this.leaveToMenu(true),
    });
    this.emit("ended", msg);
  }

  onPlayerLeft(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players.find((x) => x.slot === msg.slot);
    if (p) p.active = false;
    this.connection?.removePlayer(msg.slot);
    this.hud.setPlayers(this.match.players);
  }

  onPlayerStatus(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players.find((x) => x.slot === msg.slot);
    if (p) {
      p.connected = msg.connected;
      this.hud.setPlayers(this.match.players);
    }
  }

  // ------------------------------------------------------------- leaving

  /** Called when the game disposes our connection (Exit button, lost connection, state change). */
  onConnectionDisposed(connection) {
    if (connection !== this.connection) return;
    if (this.active) {
      log.info("left the match");
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.emit("left");
    }
    this.cleanup();
  }

  leaveToMenu(queueAgain) {
    const wasActive = this.active;
    const matchId = this.match?.matchId;
    this.hud.hide();
    const connection = this.connection;
    this.connection = null; // so dispose() below is not treated as "left"
    try {
      this.bridge.backToMenu(false, null);
    } catch (err) {
      log.error("backToMenu failed", err);
    }
    if (connection && !connection.disposed) connection.dispose();
    if (wasActive && matchId) this.client.send({ type: MSG.LEAVE_MATCH, matchId });
    this.cleanup();
    if (queueAgain) this.emit("queueAgain");
  }

  cleanup({ keepHud = false } = {}) {
    this.stopCountdown();
    const connection = this.connection;
    this.connection = null;
    if (connection && !connection.disposed) connection.dispose();
    this.match = null;
    this.track = null;
    this.prefetched = null;
    this.phase = "idle";
    this.round = 0;
    this.sessionId = null;
    this.gameStarted = false;
    if (!keepHud) this.hud.hide();
  }
}
