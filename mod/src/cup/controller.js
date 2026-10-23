import { MSG } from "../../../shared/protocol.js";
import { RankedConnection } from "../connection.js";
import { resolveTrack } from "../tracks.js";
import { installGameHooks } from "../game.js";
import { Emitter, log, safe } from "../util.js";

const ROUND_PHASES = new Set(["loading", "warmup", "countdown", "racing"]);
const RACE_PHASES = new Set(["countdown", "racing"]);

export function isEditing(ev) {
  return ev.composedPath().some((t) => ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable);
}

/**
 * The always-on cup on the client. Drives the game through PolyCup-style live rounds:
 *
 * - a round is one game session; racers report when their game exists, practise during the
 *   warmup (restart allowed), get their car put back on the start line for the countdown, and the
 *   car's clock is started for everyone at GO (controls are held until then);
 * - one run per round: the checkpoint key respawns (a respawn before the first checkpoint restarts
 *   the run but the round time keeps running), the restart key retires; checkpoints and the finish
 *   are reported to the server, which closes the round `finishTimeoutSeconds` after the first finish;
 * - once finished or retired (or while waiting for the next round as a late joiner) the view follows
 *   the racers still driving with the game's chase camera; the game's free camera stays available.
 *
 * Events: "started" (joined), "left" ({reason}), "error" (text), "state" (public cup state).
 */
export class CupController extends Emitter {
  constructor({ client, bridge, game, native, hud }) {
    super();
    this.client = client;
    this.bridge = bridge;
    this.game = game;
    this.native = native;
    this.hud = hud;
    this.match = null; // match_found / match_resume message
    this.state = null; // latest public cup state
    this.you = null;
    this.connection = null;
    this.track = null;
    this.prefetched = null;
    this.sessionId = null;
    this.gameStarted = false;
    this.runtime = null; // per-session client state, see newRuntime()
    this.view = { watchSlot: null, freecam: false, freecamGame: null, following: false, followingGame: null, cockpit: false };
    this.activeGame = null;
    this.gameInfo = null;
    this.uploadsGame = null;
    this.thumbnails = new Map();
    this._unsubs = [];
    this.listen();
    if (native) {
      installGameHooks(native, {
        onGameUpdate: (g, dt) => this.onGameUpdate(g, dt),
        beforeRender: (g, dt) => this.beforeRender(g, dt),
        onGameDisposed: (g) => this.onGameDisposed(g),
        shouldBlockControls: (g) => this.shouldBlockControls(g),
        handleRestart: (g) => this.handleRestart(g),
      });
    }
    this.onKeyDown = (ev) => this.keyDown(ev);
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    hud?.bind?.(this);
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs = [];
    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    this.cleanup();
  }

  get active() {
    return this.match != null;
  }

  get phase() {
    return this.state?.phase ?? null;
  }

  get live() {
    return this.state?.live ?? null;
  }

  get rules() {
    return this.state?.rules ?? {};
  }

  serverNow() {
    return this.client.serverNow();
  }

  listen() {
    const on = (type, fn) => this._unsubs.push(this.client.on(type, (msg) => safe(() => fn(msg), type)));
    on(MSG.MATCH_FOUND, (msg) => this.onMatchFound(msg));
    on(MSG.MATCH_RESUME, (msg) => this.onMatchResume(msg));
    on(MSG.ROUND_START, (msg) => this.onRoundStart(msg));
    on(MSG.ROUND_END, (msg) => this.onRoundEnd(msg));
    on(MSG.CUP_STATE, (msg) => this.onCupState(msg));
    on(MSG.CUP_END, (msg) => this.onCupEnd(msg));
    on(MSG.RECORDS, (msg) => this.onRecords(msg));
    on(MSG.PLAYER_LEFT, (msg) => this.onPlayerLeft(msg));
    on(MSG.PLAYER_STATUS, (msg) => this.onPlayerStatus(msg));
    on(MSG.PINGS, (msg) => this.isSameMatch(msg) && this.connection?.setPings(msg.pings));
    on(MSG.CAR_RESET, (msg) => this.isSameMatch(msg) && this.connection?.handleCarReset(msg.sessionId, msg.slot, msg.resetCounter));
    on(MSG.SERVER_MESSAGE, (msg) => this.isSameMatch(msg) && this.connection?.serverMessage(msg.text));
    this._unsubs.push(this.client.on("binary", (bytes) => this.connection?.handleRelay(bytes)));
    this._unsubs.push(
      this.client.on("state", ({ state }) => {
        if (state === "disconnected" && this.active && this.connection) this.hud.notice("Connection lost – trying to reconnect…", 6000);
      }),
    );
  }

  isSameMatch(msg) {
    return !!this.match && msg.matchId === this.match.matchId;
  }

  // ------------------------------------------------------------- joining

  async onMatchFound(msg) {
    if (!msg.format?.cup) return;
    if (this.active) this.cleanup({ keepHud: true });
    await this.enter(msg, "joined");
  }

  async onMatchResume(msg) {
    if (!msg.format?.cup) return;
    this.cleanup({ keepHud: true });
    await this.enter(msg, "resumed");
  }

  async enter(msg, how) {
    this.match = msg;
    this.you = msg.you;
    this.applyState(msg.cup, { silent: true });
    this.hud.show();
    if (!ROUND_PHASES.has(msg.phase)) this.hud.showLobby();
    this.emit("started", msg);
    const track = await this.loadTrack(msg.track);
    if (this.match !== msg) return;
    if (!track) return;
    this.track = track;
    this.connection = this.createConnection(msg);
    this.client.send({ type: MSG.MATCH_READY, matchId: msg.matchId });
    log.info(`${how} the cup (slot ${msg.you}, phase ${msg.phase})`);
    // A round is running: watch it from inside the session until the next one.
    if (ROUND_PHASES.has(msg.phase) && msg.sessionId) this.enterSession(msg.sessionId, { racer: msg.cup?.live?.racers?.includes(msg.you) ?? false });
  }

  async loadTrack(info) {
    try {
      return await resolveTrack(this.bridge, this.game, info);
    } catch (err) {
      log.error("failed to load the cup track", err);
      this.emit("error", `Could not load track "${info?.name ?? "?"}": ${err.message}`);
      if (this.match) this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.cleanup();
      return null;
    }
  }

  createConnection(msg) {
    const connection = new RankedConnection({
      client: this.client,
      matchSlot: msg.you,
      players: msg.players,
      carStyleCodec: this.game.CarStyle ?? this.carStyleClassFromProfile(),
      gameMode: this.gameMode(),
      transformRecord: (frames) => this.lapFrames(frames),
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

  gameMode() {
    const mode = this.state?.gameMode ?? this.match?.format?.gameMode;
    return typeof mode === "number" ? mode : this.game.competitiveMode;
  }

  // ------------------------------------------------------------- rounds

  newRuntime(sessionId, racer) {
    return {
      sessionId,
      racer,
      attached: false,
      readySent: false,
      warmupReadySent: false,
      stage: null, // "warmup" | "race"
      startedCar: null,
      hookedCar: null,
      timeOffset: 0, // round time spent before the current car (restarts before the first checkpoint)
      done: false,
      finishFrames: null,
      retired: false,
      checkpointSent: -1,
    };
  }

  async onRoundStart(msg) {
    if (!this.isSameMatch(msg) || !this.connection) return;
    if (msg.cup) this.applyState(msg.cup, { silent: true });
    this.hud.hideLobby();
    if (msg.players) this.connection.setPlayers(msg.players);
    if (msg.track && (!this.track || msg.track.id !== this.track.id)) {
      const track = this.prefetched?.id === msg.track.id ? this.prefetched.track : await this.loadTrack(msg.track);
      if (!track) return;
      this.prefetched = null;
      this.track = track;
      if (this.match) this.match.track = msg.track;
    }
    if (!this.connection || this.state?.live?.sessionId !== msg.sessionId) return; // superseded while loading
    this.enterSession(msg.sessionId, { racer: Array.isArray(msg.racers) ? msg.racers.includes(this.you) : true });
    this.hud.update();
  }

  /** Start (or restart) the game on the current track for a session. */
  enterSession(sessionId, { racer }) {
    this.sessionId = sessionId;
    this.runtime = this.newRuntime(sessionId, racer);
    this.view.watchSlot = null;
    this.view.freecam = false;
    this.view.freecamGame = null;
    this.connection.startSession(sessionId, this.track, { announce: false });
    const info = { multiplayerConnection: this.connection, sessionId, gameMode: this.gameMode() };
    try {
      this.bridge.startGame(this.track.trackMetadata, this.track.trackData, this.track.category ?? "custom", [], info, false);
      this.gameStarted = true;
    } catch (err) {
      log.error("failed to start the cup round", err);
      this.emit("error", `Could not start the round: ${err.message}`);
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.cleanup();
    }
  }

  /** The game created its in-game state for `sessionId`. */
  onStateAttached(sessionId) {
    const rt = this.runtime;
    if (!rt || rt.sessionId !== sessionId) return;
    rt.attached = true; // the ready report goes out from the first frame, when the game is known
  }

  sendRoundReady(game) {
    const rt = this.runtime;
    if (!rt || rt.readySent) return;
    rt.readySent = true;
    const trackId = this.track?.id ?? this.gameInfo?.trackId ?? null;
    const pb = this.localPersonalBest(game, trackId);
    this.client.send({ type: MSG.CUP_ROUND_READY, matchId: this.match.matchId, sessionId: rt.sessionId, pb });
    this.onlinePersonalBest(trackId).then((frames) => {
      if (frames != null && this.runtime === rt && (pb == null || frames < pb)) {
        this.client.send({ type: MSG.CUP_ROUND_READY, matchId: this.match.matchId, sessionId: rt.sessionId, pb: frames });
      }
    });
  }

  localPersonalBest(game, trackId) {
    if (!trackId || !this.native) return null;
    try {
      const store = this.native.store(game);
      const profiles = this.native.profiles(game);
      const frames = store?.getRecordTime?.(profiles.profileSlot, trackId)?.numberOfFrames;
      return Number.isInteger(frames) && frames > 0 ? frames : null;
    } catch {
      return null;
    }
  }

  async onlinePersonalBest(trackId) {
    if (!trackId || typeof this.bridge.api?.getLeaderboardUserEntry !== "function") return null;
    try {
      const profile = this.bridge.profiles.getCurrentUserProfile();
      const verified = this.track?.category === "official" || this.track?.category === "community";
      const entry = await Promise.race([this.bridge.api.getLeaderboardUserEntry(profile.tokenHash, trackId, verified), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))]);
      const frames = entry?.frames?.numberOfFrames ?? entry?.time?.numberOfFrames ?? (typeof entry?.frames === "number" ? entry.frames : null);
      return Number.isInteger(frames) && frames > 0 ? frames : null;
    } catch {
      return null;
    }
  }

  onRoundEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    // The session goes on through the break (the next round restarts the game); the game's own
    // Session Results only appear when the cup is decided or the lobby runs out of racers.
    if (msg.cupOver) this.connection?.endSession(msg.sessionId);
    if (msg.cup) this.applyState(msg.cup, { silent: true });
    const mine = msg.results?.find((r) => r.slot === this.you);
    if (mine && this.runtime?.racer) {
      const place = mine.position ? `${mine.position}${["st", "nd", "rd"][mine.position - 1] ?? "th"}` : "DNF";
      this.hud.notice(`Round ${msg.round}: ${place}${mine.points ? ` · +${mine.points}` : ""}`, 4000);
    }
    if (msg.nextTrack) this.prefetchTrack(msg.nextTrack);
    this.releaseView();
    this.hud.update();
  }

  onRecords(msg) {
    if (!this.isSameMatch(msg) || msg.sessionId !== this.sessionId) return;
    this.connection?.setRecords(msg.records ?? {});
  }

  onCupState(msg) {
    if (!this.isSameMatch(msg) || !msg.cup) return;
    this.applyState(msg.cup);
  }

  onCupEnd(msg) {
    if (!this.isSameMatch(msg)) return;
    this.connection?.endSession(this.sessionId);
    if (msg.cup) this.applyState(msg.cup, { silent: true });
    if (msg.nextTrack) this.prefetchTrack(msg.nextTrack);
    const won = msg.winner?.slot === this.you;
    this.hud.notice(won ? "You win the cup!" : `${msg.winner?.nickname ?? "?"} wins the cup`, 6000);
    this.releaseView();
    this.hud.update();
  }

  applyState(state, { silent = false } = {}) {
    if (!state) return;
    const before = this.state;
    this.state = state;
    if (state.players && this.connection) this.connection.setPlayers(state.players);
    if (this.match && state.players) this.match.players = state.players;
    // Fewer than minPlayers left: close the session so the game shows its Session Results.
    if (before && state.phase === "idle" && before.phase !== "idle" && this.gameStarted && this.sessionId != null) this.connection?.endSession(this.sessionId);
    if (!silent && before) {
      if (state.phase === "idle" && before.phase !== "idle" && this.gameStarted) this.hud.notice("Waiting for more racers…", 5000);
      if (state.phase === "warmup" && before.phase !== "warmup" && this.runtime?.racer) this.hud.notice(this.rules.readyEndsWarmup ? "Warmup – press Ready when you are done practising" : "Warmup", 5000);
    }
    this.hud.update();
    this.emit("state", state);
  }

  prefetchTrack(info) {
    if (!info?.id || this.prefetched?.id === info.id) return;
    resolveTrack(this.bridge, this.game, info)
      .then((track) => {
        this.prefetched = { id: info.id, track };
      })
      .catch((err) => log.warn("could not preload the next track", err));
  }

  onPlayerLeft(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players?.find((x) => x.slot === msg.slot);
    if (p) p.active = false;
    this.connection?.removePlayer(msg.slot);
    this.hud.update();
  }

  onPlayerStatus(msg) {
    if (!this.isSameMatch(msg)) return;
    const p = this.match.players?.find((x) => x.slot === msg.slot);
    if (p) p.connected = msg.connected;
    this.hud.update();
  }

  // ------------------------------------------------------------- live round (game hooks)

  /** Round time of a car time: the car's clock plus what earlier attempts of this run took. */
  lapFrames(frames) {
    const rt = this.runtime;
    return frames + (rt && rt.stage === "race" ? rt.timeOffset : 0);
  }

  isRacer() {
    return !!this.runtime?.racer;
  }

  /** Finished or retired in the running round. */
  roundDone(slot = this.you) {
    const live = this.live;
    if (slot === this.you && this.runtime?.done) return true;
    return !!live && (live.finishes?.[slot] != null || (live.dnfs ?? []).includes(slot));
  }

  /** The session the game shows is the round's session. */
  inLiveSession() {
    const live = this.live;
    const info = this.gameInfo;
    return !!live && !!info && !!this.runtime && info.sessionId === live.sessionId && this.runtime.sessionId === live.sessionId;
  }

  raceStarted() {
    const live = this.live;
    return !!live && RACE_PHASES.has(this.phase) && live.startsAt != null && this.serverNow() >= live.startsAt;
  }

  /** Called before every frame of an in-game state. @returns {boolean} whether it is the cup's game */
  onGameUpdate(game, dt) {
    if (!this.connection || !this.native) return false;
    const info = this.native.read(game);
    if (info.connection !== this.connection) return false;
    this.activeGame = game;
    this.gameInfo = info;
    if (this.uploadsGame !== game) {
      this.uploadsGame = game;
      safe(() => this.native.setUploads(game, this.rules.uploadLeaderboardTimes !== false), "setUploads");
    }
    const rt = this.runtime;
    if (!rt || info.sessionId !== rt.sessionId) return true;
    if (rt.attached && !rt.readySent) this.sendRoundReady(game);
    if (!rt.racer || !this.inLiveSession()) return true;
    const phase = this.phase;
    const stage = phase === "warmup" ? "warmup" : RACE_PHASES.has(phase) ? "race" : null;
    if (stage && rt.stage !== stage) {
      // Warmup starts on a fresh car; so does the race (the practice runs do not count).
      rt.stage = stage;
      rt.startedCar = null;
      rt.timeOffset = 0;
      rt.checkpointSent = -1;
      this.releaseView(game);
      safe(() => this.native.reset(game), "reset");
      this.connection.clearRecords();
      this.gameInfo = this.native.read(game);
    }
    const car = this.gameInfo.car;
    if (stage === "race" && car && rt.hookedCar !== car) {
      rt.hookedCar = car;
      this.hookCar(game, car, rt);
    }
    if (stage === "race" && car && this.raceStarted() && !rt.done && rt.startedCar !== car) {
      rt.startedCar = car;
      this.releaseView(game);
      if (this.gameInfo.spectator) this.gameInfo.spectator.isEnabled = false;
      // Background tabs may see GO late; the round time still counts from GO.
      rt.timeOffset = Math.max(rt.timeOffset, Math.floor(this.serverNow() - this.live.startsAt) - car.getTime().numberOfFrames);
      safe(() => car.start(), "car.start");
    }
    return true;
  }

  hookCar(game, car, rt) {
    car.addCheckpointCallback(() => {
      if (this.runtime !== rt || this.gameInfo?.car !== car) return;
      // The game passes the previous index; read the car so a frame crossing several gates reports the furthest.
      this.reportCheckpoint(car.getNextCheckpointIndex() - 1, this.lapFrames(car.getTime().numberOfFrames));
    });
    car.addFinishCallback(() => {
      if (this.runtime !== rt || this.gameInfo?.car !== car) return;
      this.reportFinish(this.lapFrames(car.getTime().numberOfFrames));
    });
  }

  /** A checkpoint of the live round (round time in frames). */
  reportCheckpoint(index, frames) {
    const rt = this.runtime;
    if (!rt?.racer || rt.done || this.phase !== "racing" || !this.raceStarted()) return false;
    if (!Number.isInteger(index) || index < 0 || index <= rt.checkpointSent) return false;
    rt.checkpointSent = index;
    if (rt.timeOffset > 0 && this.activeGame) safe(() => this.native.showRoundCheckpoint(this.activeGame, frames), "showRoundCheckpoint");
    this.client.send({ type: MSG.CUP_CHECKPOINT, matchId: this.match?.matchId, sessionId: rt.sessionId, index, frames });
    return true;
  }

  /** The finish of the live round (round time in frames). */
  reportFinish(frames) {
    const rt = this.runtime;
    if (!rt?.racer || rt.done || this.phase !== "racing" || !this.raceStarted()) return false;
    rt.done = true;
    rt.finishFrames = frames;
    if (rt.timeOffset > 0 && this.activeGame) safe(() => this.native.showRoundFinish(this.activeGame, frames), "showRoundFinish");
    this.client.send({ type: MSG.RECORD, matchId: this.match?.matchId, sessionId: rt.sessionId, frames });
    this.hud.update();
    return true;
  }

  /** Retire from the live round (restart key). */
  retire() {
    const rt = this.runtime;
    if (!rt || !rt.racer || rt.done || this.phase !== "racing" || !this.raceStarted()) return false;
    rt.done = true;
    rt.retired = true;
    this.client.send({ type: MSG.CUP_DNF, matchId: this.match?.matchId, sessionId: rt.sessionId });
    this.hud.notice("Retired from this round", 3000);
    this.hud.update();
    return true;
  }

  /** A respawn before the first checkpoint: a new run, but the round clock keeps counting. */
  restartRun(game) {
    const rt = this.runtime;
    const car = this.gameInfo?.car;
    if (!rt || !car || !this.live) return;
    rt.timeOffset = Math.max(this.lapFrames(car.getTime().numberOfFrames), Math.floor(this.serverNow() - this.live.startsAt));
    rt.checkpointSent = -1;
    safe(() => this.native.reset(game), "reset");
    this.gameInfo = this.native.read(game);
    // the new car is started (and hooked) on the next frame
  }

  shouldBlockControls(game) {
    if (!this.active || !this.connection || !this.native) return false;
    const info = game === this.activeGame && this.gameInfo ? this.gameInfo : this.native.read(game);
    if (info.connection !== this.connection) return false;
    const rt = this.runtime;
    const live = this.live;
    if (!rt || !live || info.sessionId !== live.sessionId || rt.sessionId !== live.sessionId) return true;
    if (!rt.racer) return true;
    switch (this.phase) {
      case "warmup":
        return false;
      case "countdown":
        return true;
      case "racing":
        return !this.raceStarted() || rt.done;
      default:
        return true;
    }
  }

  /** The game's start-over routine: free in the warmup, otherwise ours (retire / respawn) or nothing. */
  handleRestart(game) {
    if (!this.active || !this.connection || !this.native) return false;
    const info = game === this.activeGame && this.gameInfo ? this.gameInfo : this.native.read(game);
    if (info.connection !== this.connection) return false;
    return !(this.phase === "warmup" && this.runtime?.racer && this.inLiveSession());
  }

  keyDown(ev) {
    if (!this.active || !this.activeGame || !this.native || !this.gameInfo || this.gameInfo.ended) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing || isEditing(ev)) return;
    const game = this.activeGame;
    const info = this.gameInfo;
    const settings = this.native.settings(game);
    const KB = this.native.KeyBinding;
    if (!settings) return;
    if (this.mayWatch()) {
      if (ev.code === "BracketLeft" || ev.code === "BracketRight") {
        ev.preventDefault();
        if (!ev.repeat) this.cycleWatch(ev.code === "BracketLeft" ? -1 : 1);
        return;
      }
      if (settings.checkKeyBinding(ev, KB.ToggleSpectatorCamera)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!ev.repeat) this.toggleFreecam();
        return;
      }
    }
    const rt = this.runtime;
    if (!rt?.racer || rt.done || this.phase !== "racing" || !this.inLiveSession() || !this.raceStarted()) return;
    if (info.spectator?.isEnabled) return;
    const checkpointKey = settings.checkKeyBinding(ev, KB.VehicleCheckpointReset);
    const startKey = settings.checkKeyBinding(ev, KB.VehicleStartReset);
    if (startKey && !checkpointKey) {
      ev.preventDefault();
      if (!ev.repeat) this.retire();
      return;
    }
    if (checkpointKey) {
      const car = info.car;
      if (car && !car.hasFinished() && car.getNextCheckpointIndex() === 0) {
        // No checkpoint to go back to: the game would start over – do that ourselves and keep the clock.
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (!ev.repeat) this.restartRun(game);
      }
    }
  }

  // ------------------------------------------------------------- spectating

  /** Allowed to watch the others: a late joiner, or a racer who is done for the round. */
  mayWatch() {
    const info = this.gameInfo;
    const live = this.live;
    if (!info || !live || info.ended || !this.runtime || info.sessionId !== live.sessionId) return false;
    if (!ROUND_PHASES.has(this.phase) || this.phase === "loading") return false;
    return !this.runtime.racer || this.roundDone();
  }

  /** Racers who can be watched right now. */
  watchable() {
    const live = this.live;
    const info = this.gameInfo;
    if (!live || !info?.remoteCars) return [];
    const racing = this.phase === "racing";
    return (live.racers ?? []).filter((slot) => slot !== this.you && (!racing || !this.roundDone(slot)) && info.remoteCars.has(slot) && this.state.players?.find((p) => p.slot === slot)?.connected !== false);
  }

  cycleWatch(delta) {
    const ids = this.watchable();
    if (!ids.length) return;
    const i = ids.indexOf(this.view.watchSlot);
    this.selectWatch(ids[(i + delta + ids.length) % ids.length]);
  }

  selectWatch(slot) {
    if (!this.watchable().includes(slot)) return;
    this.view.watchSlot = slot;
    this.view.freecam = false;
    this.hud.update();
  }

  toggleFreecam() {
    if (!this.mayWatch() || this.rules.allowSpectatorFreecam === false) return;
    this.view.freecam = !this.view.freecam;
    this.view.freecamGame = null;
    if (!this.view.freecam && this.activeGame) this.releaseView(this.activeGame);
    this.hud.update();
  }

  /** Back to the own car's camera. */
  releaseView(game = this.activeGame) {
    if (this.view.following && game && this.native) safe(() => this.native.release(game, this.view.cockpit), "release");
    this.view.following = false;
    this.view.followingGame = null;
    if (this.view.freecam && game && this.native && this.gameInfo?.spectator) {
      this.gameInfo.spectator.isEnabled = false;
    }
    this.view.freecam = false;
    this.view.freecamGame = null;
  }

  /** Right before the frame is drawn: apply the spectator camera or the round-time display. */
  beforeRender(game, dt) {
    const info = this.gameInfo;
    if (!info || game !== this.activeGame || !this.native) return;
    const rt = this.runtime;
    const mayWatch = this.mayWatch();
    if (this.view.freecam && (!mayWatch || this.rules.allowSpectatorFreecam === false)) {
      this.view.freecam = false;
      this.view.freecamGame = null;
    }
    if (this.view.freecam) {
      if (this.view.freecamGame !== game) {
        if (this.view.following) {
          this.view.following = false;
          this.view.followingGame = null;
        }
        safe(() => this.native.enterFreecam(game), "enterFreecam");
        this.view.freecamGame = game;
      }
      info.car?.setVisible?.(false);
      return;
    }
    const watchable = mayWatch ? this.watchable() : [];
    if (!watchable.length) {
      if (this.view.following) {
        this.view.following = false;
        this.view.followingGame = null;
        safe(() => this.native.release(game, this.view.cockpit), "release");
      }
      if (rt?.racer && rt.stage === "race" && rt.timeOffset > 0 && !rt.done && info.car && this.phase === "racing") {
        safe(() => this.native.showRoundTime(game, this.lapFrames((info.car.getFinishTime?.() ?? info.car.getTime()).numberOfFrames)), "showRoundTime");
      }
      return;
    }
    if (!watchable.includes(this.view.watchSlot)) {
      this.view.watchSlot = watchable[0];
      this.hud.update();
    }
    if (!this.view.following) this.view.cockpit = safe(() => this.native.drivingCockpit(game), "drivingCockpit") === true;
    if (this.native.follow(game, this.view.watchSlot, dt)) {
      if (!this.view.following) this.hud.update();
      this.view.following = true;
      this.view.followingGame = game;
    }
  }

  onGameDisposed(game) {
    if (game !== this.activeGame) return;
    this.view.following = false;
    this.view.followingGame = null;
    this.view.freecamGame = null;
    this.activeGame = null;
    this.gameInfo = null;
  }

  // ------------------------------------------------------------- helpers for the HUD

  playerName(slot) {
    return this.state?.players?.find((p) => p.slot === slot)?.nickname ?? this.match?.players?.find((p) => p.slot === slot)?.nickname ?? "?";
  }

  pbOf(slot) {
    const pb = this.state?.players?.find((p) => p.slot === slot)?.pb;
    return pb === undefined ? undefined : pb;
  }

  /** Data URL of a small picture of a player's car (cached by car style). */
  carThumbnail(slot) {
    const style = this.connection?.players?.get(slot)?.carStyle;
    if (!style || !this.native?.carThumbnail || typeof style.serialize !== "function") return Promise.resolve(null);
    const key = style.serialize();
    if (!this.thumbnails.has(key)) {
      if (this.thumbnails.size > 64) this.thumbnails.delete(this.thumbnails.keys().next().value);
      this.thumbnails.set(
        key,
        Promise.resolve()
          .then(() => this.native.carThumbnail(style))
          .catch(() => null),
      );
    }
    return this.thumbnails.get(key);
  }

  warmupReady() {
    const rt = this.runtime;
    if (!rt || !rt.racer || this.phase !== "warmup" || rt.warmupReadySent) return;
    rt.warmupReadySent = true;
    this.client.send({ type: MSG.CUP_WARMUP_READY, matchId: this.match?.matchId, sessionId: rt.sessionId });
    this.hud.update();
  }

  // ------------------------------------------------------------- leaving

  /** Leave the cup: from the lobby overlay, the multiplayer page, or the game's own Exit. */
  leaveCup() {
    if (!this.active) return;
    const matchId = this.match.matchId;
    if (this.gameStarted) {
      this.leaveToMenu();
    } else {
      this.client.send({ type: MSG.CUP_LEAVE, matchId });
      this.cleanup();
    }
    this.emit("left", { reason: "left" });
  }

  /** The game disposed our connection (Exit button, lost connection, state change). */
  onConnectionDisposed(connection) {
    if (connection !== this.connection) return;
    if (this.active) {
      log.info("left the cup");
      this.client.send({ type: MSG.LEAVE_MATCH, matchId: this.match.matchId });
      this.emit("left", { reason: "exit" });
    }
    this.cleanup();
  }

  leaveToMenu() {
    const matchId = this.match?.matchId;
    const wasActive = this.active;
    this.releaseView();
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
  }

  cleanup({ keepHud = false } = {}) {
    this.releaseView();
    const connection = this.connection;
    this.connection = null;
    if (connection && !connection.disposed) connection.dispose();
    this.match = null;
    this.state = null;
    this.track = null;
    this.prefetched = null;
    this.sessionId = null;
    this.runtime = null;
    this.gameStarted = false;
    this.activeGame = null;
    this.gameInfo = null;
    this.uploadsGame = null;
    this.view = { watchSlot: null, freecam: false, freecamGame: null, following: false, followingGame: null, cockpit: false };
    if (!keepHud) this.hud.hide();
    this.emit("state", null);
  }
}
