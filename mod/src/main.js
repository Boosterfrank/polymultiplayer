import { PolyMod } from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js";
import { MSG } from "../../shared/protocol.js";
import { MOD_ID, MOD_NAME, MOD_VERSION, GAME_VERSION, SHOW_MENU_BUTTON } from "./config.js";
import { installBridgeMixin, waitForBridge, validateBridge, lookupGame, physicsDeterministic, physicsDeterminism } from "./bridge.js";
import { connectGame } from "./game.js";
import { RankedClient } from "./client.js";
import { getSecret, loadSettings, saveSettings } from "./identity.js";
import { MatchController } from "./match.js";
import { injectStyles } from "./ui/styles.js";
import { installMainMenuButton } from "./ui/mainmenu.js";
import { installCupButton } from "./ui/cupbutton.js";
import { RankedMenu } from "./ui/menu.js";
import { MatchHud } from "./ui/hud.js";
import { CupController } from "./cup/controller.js";
import { CupHud } from "./cup/hud.js";
import { SplitsController } from "./splits.js";
import { log } from "./util.js";

class PolyRankedMod extends PolyMod {
  constructor() {
    super();
    this.pml = null;
    this.bridgeInstalled = false;
    this.app = null;
    // PolyMod declares the lifecycle hooks as instance fields (no-op arrow functions), which
    // would shadow prototype methods, so the hooks are assigned on the instance here.
    this.preInit = (pml) => {
      this.pml = pml;
      this.bridgeInstalled = installBridgeMixin(pml);
      log.info("pre-init: bridge mixin " + (this.bridgeInstalled ? "registered" : "FAILED"));
    };
    this.init = (pml) => {
      this.pml = pml;
    };
    this.postInit = () => {
      if (!this.bridgeInstalled) {
        log.error("game bridge mixin not installed; PolyRanked is disabled");
        return;
      }
      waitForBridge()
        .then((bridge) => this.boot(bridge))
        .catch((err) => log.error("bridge never became ready", err));
    };
    this.onGameLoad = () => {
      this.app?.onGameLoad();
    };
  }

  boot(bridge) {
    const problems = validateBridge(bridge);
    if (problems.length) {
      log.error("unexpected game internals (" + problems.join(", ") + "); PolyRanked is disabled");
      return;
    }
    this.app = new PolyRankedApp({ pml: this.pml, bridge });
    this.app.start();
    globalThis.polyRanked = this.app;
  }
}

/** Wires the server client, the game bridge and the UI together. */
class PolyRankedApp {
  constructor({ pml, bridge }) {
    this.pml = pml;
    this.bridge = bridge;
    this.game = lookupGame(pml);
    this.settings = loadSettings();
    this.client = new RankedClient({
      url: () => this.settings.serverUrl,
      secret: () => getSecret(),
      profile: () => this.profile(),
      vanilla: () => this.isVanilla(),
      gameVersion: GAME_VERSION,
      modVersion: MOD_VERSION,
    });
    this.menu = null;
    this.hud = null;
    this.controller = null;
    this.native = null;
    this.cupHud = null;
    this.cup = null;
    this.splits = null;
    this.removeMenuButton = null;
    this.pendingQueue = null;
    this.pendingCupJoin = false;
    this.cupNotice = null;
    this.cupButton = null;
  }

  start() {
    injectStyles();
    this.menu = new RankedMenu({ settings: this.settings });
    this.hud = new MatchHud({ serverNow: () => this.client.serverNow() });
    this.hud.setEnabled(this.settings.showHud !== false);
    this.controller = new MatchController({ client: this.client, bridge: this.bridge, game: this.game, hud: this.hud });
    this.native = connectGame(this.pml);
    if (!this.native) log.warn("live-round hooks unavailable on this game build; the cup cannot be joined");
    this.cupHud = new CupHud({ serverNow: () => this.client.serverNow() });
    this.cupHud.setEnabled(this.settings.showHud !== false);
    this.cup = new CupController({ client: this.client, bridge: this.bridge, game: this.game, native: this.native, hud: this.cupHud });
    if (this.native) {
      this.splits = new SplitsController({
        native: this.native,
        client: this.client,
        enabled: () => this.settings.splits !== false,
        roundTime: (game, car, frames) => {
          const cup = this.cup;
          const rt = cup.runtime;
          if (!cup.active || !rt?.racer || rt.stage !== "race" || cup.phase !== "racing" || !cup.inLiveSession() || (game && game !== cup.activeGame)) return null;
          return { inCup: true, frames: cup.lapFrames(frames), sessionId: rt.sessionId };
        },
      });
    }
    if (SHOW_MENU_BUTTON) this.removeMenuButton = installMainMenuButton(() => this.toggleMenu());
    this.cupButton = installCupButton({
      onJoin: () => this.joinCup(),
      onLeave: () => this.cup.leaveCup(),
      fetchState: () => this.fetchCupState(),
      localState: () => ({ inCup: this.cup.active, phase: this.cup.phase, racing: this.cup.isRacer(), notice: this.cupNotice }),
      serverNow: () => this.client.serverNow(),
    });
    this.onKeyDown = (ev) => {
      if (ev.code === "F7" && !ev.repeat) {
        ev.preventDefault();
        this.toggleMenu();
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
    this.wire();
    if (this.settings.autoConnect !== false) this.client.connect();
    this.scheduleGaragePrompt();
    log.info(`${MOD_NAME} ${MOD_VERSION} ready (server: ${this.settings.serverUrl})`);
  }

  /**
   * New profiles race as "Anonymous" with a random car. Once the main menu is idle, ask once
   * whether to visit the Garage to pick a nickname and car before playing ranked.
   */
  scheduleGaragePrompt() {
    const KEY = "polyranked.garagePrompted";
    let storage = null;
    try {
      storage = globalThis.localStorage;
    } catch {
      /* ignore */
    }
    if (storage?.getItem(KEY) || this.settings.nameOverride || typeof this.bridge.openGarage !== "function") return;
    const needsName = () => {
      try {
        const p = this.bridge.profiles.getCurrentUserProfile();
        return !p.nickname || p.nickname === "Anonymous";
      } catch {
        return false;
      }
    };
    if (!needsName()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 600) return clearInterval(timer);
      if (this.controller.active || this.cup.active || this.menu.isOpen) return;
      let ready = false;
      try {
        const state = this.bridge.getState();
        const classes = this.bridge.getStateClasses();
        ready = state instanceof classes.MainMenu && !this.bridge.popups.isOpen && !document.querySelector(".news-popup-ui") && !document.querySelector(".loading-screen");
      } catch {
        ready = false;
      }
      if (!ready) return;
      clearInterval(timer);
      if (!needsName()) return;
      storage?.setItem(KEY, "1");
      try {
        this.bridge.popups.showConfirm(
          "Welcome to ranked PolyTrack!\n\nYou are playing as \"Anonymous\" with a random car. Visit the Garage to pick your nickname and car first – other players will see them in matches.",
          "Later",
          "Go to Garage",
          null,
          () => {
            try {
              this.bridge.openGarage();
            } catch (err) {
              log.error("could not open the garage", err);
            }
          },
        );
      } catch (err) {
        log.warn("garage prompt failed", err);
      }
    }, 500);
  }

  onGameLoad() {
    // The main menu exists now; make sure the button is there even if the observer missed it.
    if (!SHOW_MENU_BUTTON) return;
    this.removeMenuButton?.();
    this.removeMenuButton = installMainMenuButton(() => this.toggleMenu());
  }

  profile() {
    let nickname = "Anonymous";
    let countryCode = null;
    let carStyle = null;
    try {
      const p = this.bridge.profiles.getCurrentUserProfile();
      nickname = p.nickname ?? nickname;
      countryCode = p.countryCode ?? null;
      carStyle = typeof p.carStyle?.serialize === "function" ? p.carStyle.serialize() : null;
    } catch (err) {
      log.warn("could not read the user profile", err);
    }
    if (this.settings.nameOverride) nickname = this.settings.nameOverride;
    return { nickname, countryCode, carStyle };
  }

  isVanilla() {
    let vanilla = true;
    try {
      vanilla = this.pml.isVanillaCompatible() !== false;
    } catch {
      /* ignore */
    }
    return vanilla && physicsDeterministic(this.bridge, this.game);
  }

  /** Names of the loaded mods that report a physics change (with their reason when they give one). */
  physicsMods() {
    try {
      return this.pml
        .getAllMods()
        .filter((m) => m.isLoaded && m.touchingPhysics === true)
        .map((m) => (m.physicsReason ? `${m.modName} (${m.physicsReason})` : m.modName));
    } catch {
      return [];
    }
  }

  toggleMenu() {
    // Do not cover the game while racing; the HUDs show the match / cup state.
    if (this.controller.active && !this.menu.isOpen) return;
    if (this.cup.active && this.cup.gameStarted && !this.menu.isOpen) return;
    this.menu.toggle();
  }

  // ------------------------------------------------------------- cup

  httpBase() {
    return String(this.settings.serverUrl ?? "")
      .trim()
      .replace(/^wss:/i, "https:")
      .replace(/^ws:/i, "http:")
      .replace(/\/+$/, "");
  }

  async fetchCupState() {
    const base = this.httpBase();
    if (!/^https?:/.test(base)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${base}/api/cup`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** "Join the Cup" on the multiplayer page: connect if needed, then ask the server for a seat. */
  joinCup() {
    this.cupNotice = null;
    if (this.cup.active) {
      this.cupButton?.refresh();
      return;
    }
    if (this.controller.active) {
      this.cupNotice = "Finish your ranked match first";
      this.cupButton?.refresh();
      return;
    }
    if (!this.native) {
      this.cupNotice = "The cup needs PolyTrack 0.6.3 internals this game build does not have";
      this.cupButton?.refresh();
      return;
    }
    const determinism = physicsDeterminism(this.bridge, this.game);
    if (determinism === "pending") {
      this.cupNotice = "The game is still running its physics self-test – try again in a few seconds";
      this.cupButton?.refresh();
      return;
    }
    if (!this.isVanilla()) {
      const culprits = this.physicsMods();
      this.cupNotice = culprits.length ? `The cup needs vanilla physics. Mods changing it: ${culprits.join(", ")}` : "The cup needs vanilla physics (the game's physics self-test failed)";
      this.cupButton?.refresh();
      return;
    }
    if (this.client.ready) this.sendCupJoin();
    else {
      this.pendingCupJoin = true;
      this.cupNotice = "Connecting to the server…";
      this.client.connect();
    }
    this.cupButton?.refresh();
  }

  sendCupJoin() {
    this.pendingCupJoin = false;
    this.client.send({ type: MSG.CUP_JOIN, vanilla: true });
  }

  wire() {
    const { client, menu, controller } = this;

    client.on("state", ({ state, detail }) => {
      menu.setConnectionState(state, detail);
      if (state === "ready") {
        menu.setWelcome(client.welcome);
        if (this.pendingQueue) {
          client.send({ type: MSG.QUEUE_JOIN, queue: this.pendingQueue });
          this.pendingQueue = null;
        }
        if (this.pendingCupJoin) {
          this.cupNotice = null;
          this.sendCupJoin();
        }
        if (client.welcome?.cup) this.cupButton?.setState(client.welcome.cup);
      } else if (state === "disconnected" && this.pendingCupJoin && detail) {
        this.pendingCupJoin = false;
        this.cupNotice = `Could not reach the server – ${detail}`;
      }
      this.cupButton?.refresh();
    });
    client.on(MSG.QUEUE_STATUS, (msg) => menu.setQueueStatus(msg));
    client.on(MSG.LEADERBOARD, (msg) => menu.setLeaderboard(msg));
    client.on(MSG.PROFILE, (msg) => menu.setProfile(msg.profile));
    client.on("error", (msg) => {
      menu.setNotice(msg.message, "error");
      if (msg.code === "cannot_queue" || msg.code === "in_match") menu.setQueueStatus(null);
      if (["cup_full", "cup_disabled", "cannot_queue", "in_match"].includes(msg.code) && !controller.active && !this.cup.active) {
        this.cupNotice = msg.message;
        this.cupButton?.refresh();
      }
    });
    client.on(MSG.MATCH_FOUND, (msg) => {
      menu.setQueueStatus(null);
      this.cupNotice = null;
      menu.setNotice(msg.format?.cup ? `Joined the ${msg.queueName ?? "cup"} – loading ${msg.track?.name ?? "the track"}…` : `Match found on ${msg.track?.name ?? "a track"} – loading…`);
      menu.close();
      this.cupButton?.refresh();
    });
    client.on(MSG.CUP_STATE, (msg) => this.cupButton?.setState(msg.cup));
    client.on(MSG.MATCH_END, (msg) => {
      const r = msg.ratings?.[controller.match?.you];
      if (r) {
        menu.setNotice(`Last match: ${r.result} (${r.delta >= 0 ? "+" : ""}${r.delta}) – ${r.division}`);
        // Refresh the profile shown in the menu.
        if (client.welcome?.profile?.ratings?.[controller.match.queueId]) {
          const entry = client.welcome.profile.ratings[controller.match.queueId];
          entry.rating = r.after;
          entry.label = r.division;
          entry.matches = (entry.matches ?? 0) + 1;
          if (r.result === "win") entry.wins = (entry.wins ?? 0) + 1;
          else if (r.result === "loss") entry.losses = (entry.losses ?? 0) + 1;
          menu.setProfile(client.welcome.profile);
        }
      }
    });

    menu.on("connect", () => client.connect());
    menu.on("disconnect", () => client.disconnect());
    menu.on("queue", (queueId) => {
      menu.setNotice(null);
      if (this.cup.active) {
        menu.setNotice("Leave the cup before queueing for ranked.", "error");
        return;
      }
      const determinism = physicsDeterminism(this.bridge, this.game);
      if (determinism === "pending") {
        menu.setNotice("The game is still running its physics self-test – try again in a few seconds.", "error");
        return;
      }
      if (!this.isVanilla()) {
        const culprits = this.physicsMods();
        menu.setNotice(
          culprits.length
            ? `Ranked requires vanilla physics. Mods changing it: ${culprits.join(", ")}.`
            : "Ranked requires vanilla physics: disable physics mods and make sure the game's physics self-test passed.",
          "error",
        );
        return;
      }
      client.send({ type: MSG.QUEUE_JOIN, queue: queueId, vanilla: true });
    });
    menu.on("cancelQueue", () => client.send({ type: MSG.QUEUE_LEAVE }));
    menu.on("leaderboard", (queueId) => client.send({ type: MSG.LEADERBOARD_GET, queue: queueId }));
    menu.on("settings", (patch) => {
      const urlChanged = patch.serverUrl !== this.settings.serverUrl;
      this.settings = saveSettings({ ...this.settings, ...patch });
      menu.setSettings(this.settings);
      this.hud.setEnabled(this.settings.showHud !== false);
      this.cupHud.setEnabled(this.settings.showHud !== false);
      if (urlChanged) {
        client.disconnect();
        client.connect();
      }
    });

    controller.on("error", (text) => {
      menu.setNotice(text, "error");
      menu.open();
    });
    controller.on("left", () => {
      menu.setNotice("You left the match (counts as a loss).");
      this.cupButton?.refresh();
    });
    this.cup.on("error", (text) => {
      menu.setNotice(text, "error");
      menu.open();
    });
    this.cup.on("left", () => {
      menu.setNotice("You left the cup.");
      this.cupButton?.refresh();
    });
    this.cup.on("state", (state) => {
      if (state) this.cupButton?.setState(state);
      else this.cupButton?.refresh();
    });
    controller.on("queueAgain", () => {
      const queueId = controller.matchEnd?.queueId ?? client.welcome?.queues?.[0]?.id;
      menu.open();
      if (queueId && client.ready) client.send({ type: MSG.QUEUE_JOIN, queue: queueId });
      else this.pendingQueue = queueId ?? null;
    });
  }
}

export const polyMod = Object.assign(new PolyRankedMod(), {
  modName: MOD_NAME,
  modID: MOD_ID,
  modVersion: MOD_VERSION,
  modAuthor: "boosterfrank",
  touchingPhysics: false,
});
