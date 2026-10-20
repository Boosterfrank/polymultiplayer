import { PolyMod } from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js";
import { MSG } from "../../shared/protocol.js";
import { MOD_ID, MOD_NAME, MOD_VERSION, GAME_VERSION } from "./config.js";
import { installBridgeMixin, waitForBridge, validateBridge, lookupGame, physicsDeterministic, physicsDeterminism } from "./bridge.js";
import { RankedClient } from "./client.js";
import { getSecret, loadSettings, saveSettings } from "./identity.js";
import { MatchController } from "./match.js";
import { injectStyles } from "./ui/styles.js";
import { installMainMenuButton } from "./ui/mainmenu.js";
import { RankedMenu } from "./ui/menu.js";
import { MatchHud } from "./ui/hud.js";
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
    this.removeMenuButton = null;
    this.pendingQueue = null;
  }

  start() {
    injectStyles();
    this.menu = new RankedMenu({ settings: this.settings });
    this.hud = new MatchHud({ serverNow: () => this.client.serverNow() });
    this.hud.setEnabled(this.settings.showHud !== false);
    this.controller = new MatchController({ client: this.client, bridge: this.bridge, game: this.game, hud: this.hud });
    this.removeMenuButton = installMainMenuButton(() => this.toggleMenu());
    this.onKeyDown = (ev) => {
      if (ev.code === "F7" && !ev.repeat) {
        ev.preventDefault();
        this.toggleMenu();
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
    this.wire();
    if (this.settings.autoConnect !== false) this.client.connect();
    log.info(`${MOD_NAME} ${MOD_VERSION} ready (server: ${this.settings.serverUrl})`);
  }

  onGameLoad() {
    // The main menu exists now; make sure the button is there even if the observer missed it.
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

  toggleMenu() {
    if (this.controller.active && !this.menu.isOpen) {
      // Do not cover the game while racing; the HUD shows the match state.
      return;
    }
    this.menu.toggle();
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
      }
    });
    client.on(MSG.QUEUE_STATUS, (msg) => menu.setQueueStatus(msg));
    client.on(MSG.LEADERBOARD, (msg) => menu.setLeaderboard(msg));
    client.on(MSG.PROFILE, (msg) => menu.setProfile(msg.profile));
    client.on("error", (msg) => {
      menu.setNotice(msg.message, "error");
      if (msg.code === "cannot_queue" || msg.code === "in_match") menu.setQueueStatus(null);
    });
    client.on(MSG.MATCH_FOUND, (msg) => {
      menu.setQueueStatus(null);
      menu.setNotice(`Match found on ${msg.track?.name ?? "a track"} – loading…`);
      menu.close();
    });
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
      const determinism = physicsDeterminism(this.bridge, this.game);
      if (determinism === "pending") {
        menu.setNotice("The game is still running its physics self-test – try again in a few seconds.", "error");
        return;
      }
      if (!this.isVanilla()) {
        menu.setNotice("Ranked requires vanilla physics: disable physics mods and make sure the game's physics self-test passed.", "error");
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
      if (urlChanged) {
        client.disconnect();
        client.connect();
      }
    });

    controller.on("error", (text) => {
      menu.setNotice(text, "error");
      menu.open();
    });
    controller.on("left", () => menu.setNotice("You left the match (counts as a loss)."));
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
