import { el, clearChildren, formatSeconds, Emitter } from "../util.js";
import { MOD_VERSION } from "../config.js";
import { normalizeServerUrl } from "../identity.js";

/**
 * The Ranked menu panel. Events: connect, disconnect, queue(queueId), cancelQueue,
 * leaderboard(queueId), settings(settingsPatch), close.
 */
export class RankedMenu extends Emitter {
  constructor({ settings }) {
    super();
    this.settings = settings;
    this.connectionState = { state: "disconnected", detail: null };
    this.profile = null;
    this.queues = [];
    this.queueStatus = null;
    this.canQueue = true;
    this.queueReason = null;
    this.notice = null;
    this.leaderboard = null;
    this.view = "main"; // main | leaderboard | settings
    this.root = el("div", { className: "polyranked-ui hidden", on: { click: (ev) => ev.target === this.root && this.close() } });
    this.box = el("div", { className: "pr-box" });
    this.root.appendChild(this.box);
    document.getElementById("ui")?.appendChild(this.root);
    this._timer = null;
    this.render();
  }

  dispose() {
    this.stopTimer();
    this.root.remove();
  }

  get isOpen() {
    return !this.root.classList.contains("hidden");
  }

  open() {
    this.root.classList.remove("hidden");
    this.render();
    this.startTimer();
  }

  close() {
    this.root.classList.add("hidden");
    this.stopTimer();
    this.emit("close");
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => {
      if (this.queueStatus && this.waitLabel) this.waitLabel.textContent = this.queueText();
    }, 500);
  }

  stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  // ------------------------------------------------------------- state setters

  setConnectionState(state, detail) {
    this.connectionState = { state, detail };
    if (state !== "ready") this.queueStatus = null;
    this.render();
  }

  setWelcome(welcome) {
    this.profile = welcome.profile;
    this.queues = welcome.queues ?? [];
    this.canQueue = welcome.canQueue !== false;
    this.queueReason = welcome.queueReason ?? null;
    this.render();
  }

  setProfile(profile) {
    this.profile = profile;
    this.render();
  }

  setQueueStatus(status) {
    this.queueStatus = status && status.inQueue !== false ? { ...status, receivedAt: Date.now() } : null;
    this.render();
  }

  setNotice(text, kind = "info") {
    this.notice = text ? { text, kind } : null;
    this.render();
  }

  setLeaderboard(data) {
    this.leaderboard = data;
    if (this.view === "leaderboard") this.render();
  }

  setSettings(settings) {
    this.settings = settings;
    this.render();
  }

  queueText() {
    const s = this.queueStatus;
    if (!s) return "";
    const waited = (s.waitedMs ?? 0) + (Date.now() - s.receivedAt);
    return `Searching ${this.queueName(s.queueId)}… ${formatSeconds(waited / 1000)}  (${s.waiting}/${s.required} in queue)`;
  }

  queueName(id) {
    return this.queues.find((q) => q.id === id)?.name ?? id;
  }

  // ------------------------------------------------------------- rendering

  render() {
    clearChildren(this.box);
    this.box.appendChild(el("h2", { text: "Ranked" }));
    if (this.view === "leaderboard") this.renderLeaderboard();
    else if (this.view === "settings") this.renderSettings();
    else this.renderMain();
  }

  button(text, onClick, { disabled = false, icon = null } = {}) {
    const b = el("button", { className: "button", on: { click: onClick } });
    if (icon) b.appendChild(el("img", { className: "button-icon", attrs: { src: icon } }));
    b.appendChild(document.createTextNode(text));
    b.disabled = disabled;
    return b;
  }

  statusLine() {
    const { state, detail } = this.connectionState;
    let text;
    let cls = "pr-status";
    if (state === "ready") {
      text = `Connected to ${this.settings.serverUrl}`;
      cls += " ok";
    } else if (state === "connected") text = "Signing in…";
    else if (state === "connecting") text = `Connecting to ${this.settings.serverUrl}…`;
    else {
      text = detail ? `Offline – ${detail}` : "Offline";
      cls += " err";
    }
    return el("div", { className: cls, text });
  }

  renderMain() {
    const { state } = this.connectionState;
    const conn = el("div", { className: "pr-section" });
    const row = el("div", { className: "pr-row" }, [this.statusLine()]);
    if (state === "disconnected") row.appendChild(this.button("Connect", () => this.emit("connect")));
    else row.appendChild(this.button("Disconnect", () => this.emit("disconnect")));
    conn.appendChild(row);
    if (this.notice) conn.appendChild(el("div", { className: "pr-status " + (this.notice.kind === "error" ? "err" : ""), text: this.notice.text, style: { marginTop: "8px" } }));
    this.box.appendChild(conn);

    if (this.profile) {
      const ratings = el("div", { className: "pr-ratings" });
      for (const q of this.queues) {
        const r = this.profile.ratings?.[q.id];
        if (!r) continue;
        ratings.appendChild(
          el("div", { className: "pr-rating" }, [
            el("div", { className: "pr-q", text: q.name }),
            el("div", { className: "pr-div", text: r.label }),
            el("div", { className: "pr-num", text: `${r.rating} pts · ${r.wins}W ${r.losses}L` }),
          ]),
        );
      }
      this.box.appendChild(
        el("div", { className: "pr-section pr-profile" }, [el("div", { className: "pr-name", text: this.profile.nickname }), ratings]),
      );
    }

    if (state === "ready") {
      const section = el("div", { className: "pr-section" });
      if (this.queueStatus) {
        this.waitLabel = el("div", { text: this.queueText() });
        section.appendChild(el("div", { className: "pr-searching" }, [el("div", { className: "pr-spinner" }), this.waitLabel]));
        section.appendChild(el("div", { className: "pr-row", style: { marginTop: "10px", justifyContent: "flex-end" } }, [this.button("Cancel", () => this.emit("cancelQueue"))]));
      } else {
        section.appendChild(el("h3", { text: "Play" }));
        if (!this.canQueue && this.queueReason) section.appendChild(el("div", { className: "pr-status err", text: this.queueReason }));
        const grid = el("div", { className: "pr-queues" });
        for (const q of this.queues) {
          const format = q.teams ? `${q.teamSize}v${q.teamSize} · first to ${q.roundsToWin} rounds` : `${q.players} players · ${q.maxRounds} rounds`;
          grid.appendChild(
            el("div", { className: "pr-queue" }, [
              el("div", { className: "pr-qname", text: q.name }),
              el("div", { className: "pr-qinfo", text: format }),
              el("div", { className: "pr-qinfo", text: `${q.waiting ?? 0} in queue` }),
              this.button("Queue", () => this.emit("queue", q.id), { disabled: !this.canQueue }),
            ]),
          );
        }
        section.appendChild(grid);
      }
      this.box.appendChild(section);
    }

    const buttons = el("div", { className: "pr-buttons" }, [
      el("span", { className: "pr-small", text: `PolyRanked ${MOD_VERSION}`, style: { marginRight: "auto", alignSelf: "center" } }),
      this.button("Leaderboard", () => {
        this.view = "leaderboard";
        this.emit("leaderboard", this.queues[0]?.id ?? "duel");
        this.render();
      }, { disabled: state !== "ready" }),
      this.button("Settings", () => {
        this.view = "settings";
        this.render();
      }),
      this.button("Close", () => this.close()),
    ]);
    this.box.appendChild(buttons);
  }

  renderLeaderboard() {
    const section = el("div", { className: "pr-section" });
    const tabs = el("div", { className: "pr-row", style: { marginBottom: "10px" } });
    for (const q of this.queues) {
      tabs.appendChild(this.button(q.name, () => this.emit("leaderboard", q.id), { disabled: this.leaderboard?.queue === q.id }));
    }
    section.appendChild(tabs);
    if (!this.leaderboard) section.appendChild(el("div", { className: "pr-status", text: "Loading…" }));
    else if (this.leaderboard.entries.length === 0) section.appendChild(el("div", { className: "pr-status", text: "Nobody has finished their placement matches yet." }));
    else {
      const table = el("table");
      table.appendChild(el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Player" }), el("th", { text: "Division" }), el("th", { text: "Rating" }), el("th", { text: "W / L" })]));
      for (const e of this.leaderboard.entries) {
        table.appendChild(
          el("tr", { className: e.id === this.profile?.id ? "self" : "" }, [
            el("td", { text: String(e.position) }),
            el("td", { text: e.nickname }),
            el("td", { text: e.division }),
            el("td", { text: String(e.rating) }),
            el("td", { text: `${e.wins} / ${e.losses}` }),
          ]),
        );
      }
      section.appendChild(table);
    }
    this.box.appendChild(section);
    this.box.appendChild(
      el("div", { className: "pr-buttons" }, [
        this.button("Back", () => {
          this.view = "main";
          this.render();
        }),
      ]),
    );
  }

  renderSettings() {
    const section = el("div", { className: "pr-section" });
    const urlInput = el("input", { attrs: { type: "text", spellcheck: "false", autocomplete: "off" } });
    urlInput.value = this.settings.serverUrl;
    const nameInput = el("input", { attrs: { type: "text", spellcheck: "false", autocomplete: "off", maxlength: "24", placeholder: "Use my PolyTrack nickname" } });
    nameInput.value = this.settings.nameOverride ?? "";
    const auto = el("input", { attrs: { type: "checkbox" } });
    auto.checked = this.settings.autoConnect !== false;
    const hud = el("input", { attrs: { type: "checkbox" } });
    hud.checked = this.settings.showHud !== false;
    const splits = el("input", { attrs: { type: "checkbox" } });
    splits.checked = this.settings.splits !== false;
    section.appendChild(el("label", { text: "Ranked server (ws:// or wss://)" }));
    section.appendChild(urlInput);
    section.appendChild(el("label", { text: "Nickname override", style: { marginTop: "12px" } }));
    section.appendChild(nameInput);
    section.appendChild(el("label", { style: { marginTop: "12px" } }, [auto, " Connect automatically when the game starts"]));
    section.appendChild(el("label", {}, [hud, " Show the match HUD"]));
    section.appendChild(el("label", {}, [splits, " Checkpoint splits (Trackmania style, in every run)"]));
    section.appendChild(el("div", { className: "pr-small", text: "Your identity is a random key stored in this browser; clearing site data resets your rating.", style: { marginTop: "12px" } }));
    this.box.appendChild(section);
    this.box.appendChild(
      el("div", { className: "pr-buttons" }, [
        this.button("Back", () => {
          this.view = "main";
          this.render();
        }),
        this.button("Save", () => {
          const patch = { serverUrl: normalizeServerUrl(urlInput.value), nameOverride: nameInput.value.trim().slice(0, 24), autoConnect: auto.checked, showHud: hud.checked, splits: splits.checked };
          this.view = "main";
          this.emit("settings", patch);
        }),
      ]),
    );
  }
}
