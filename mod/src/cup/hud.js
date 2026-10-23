import { el, clearChildren } from "../util.js";
import { standings } from "../../../shared/cupstandings.js";

const PHASE_NAMES = { idle: "Waiting for racers…", break: "Waiting for next round…", loading: "Loading…", warmup: "Warmup", countdown: "Get ready", racing: "Live round", complete: "Cup over" };
const PLACEHOLDER_CAR = "images/car_thumbnail_placeholder.png";
const ORIGINAL_HINT = " to start over.";
const RETIRE_HINT = " to retire from this round.";

/** m:ss.mmm like the game's own time displays. */
export function fmtTime(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "—";
  const ms = Math.floor(frames);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function fmtGap(frames) {
  if (!Number.isFinite(frames) || frames < 0) return "—";
  return `+${frames < 60000 ? (Math.floor(frames) / 1000).toFixed(3) : fmtTime(frames)}`;
}

/**
 * The cup's in-game overlay, laid out like PolyCup: a panel in the top-left corner with the track,
 * the round, the world record and the cup's track record and the ranking (live race order during a
 * round, cup standings otherwise), a finish-window timer, the 3-2-1-GO cue, a phase label, the warmup
 * controls, the spectator selector with the watched racer's personal best, and a lobby overlay while
 * waiting in the menu. Everything is rebuilt from the cup's public state; clocks tick locally.
 */
export class CupHud {
  constructor({ serverNow }) {
    this.serverNow = serverNow;
    this.c = null;
    this.enabled = true;
    this.visible = false;
    const ui = document.getElementById("ui") ?? document.body;
    this.root = el("aside", { className: "prc-hud hidden" });
    this.povEl = el("div", { className: "prc-pov hidden" });
    this.pbEl = el("div", { className: "prc-pb hidden" });
    this.timerEl = el("div", { className: "prc-round-timer" });
    this.cueEl = el("div", { className: "prc-start-cue hidden" });
    this.downtimeEl = el("div", { className: "prc-downtime hidden" });
    this.practiceEl = el("div", { className: "prc-practice hidden" });
    this.noticeEl = el("div", { className: "prc-notice hidden" });
    this.overlay = el("div", { className: "polyranked-overlay prc-lobby-overlay hidden" });
    for (const node of [this.root, this.povEl, this.pbEl, this.timerEl, this.cueEl, this.downtimeEl, this.practiceEl, this.noticeEl, this.overlay]) ui.appendChild(node);
    this.lobbyEl = null;
    this.lobbyCountdownEl = null;
    this.ticker = null;
    this.signature = null;
    this.cueValue = "";
    this.thumbs = new Map(); // slot -> data url
    this.hintNodes = new Map(); // text node -> original text
    this.noticeTimer = null;
    this.toolbarTop = 0;
  }

  bind(controller) {
    this.c = controller;
  }

  dispose() {
    this.hide();
    for (const node of [this.root, this.povEl, this.pbEl, this.timerEl, this.cueEl, this.downtimeEl, this.practiceEl, this.noticeEl, this.overlay]) node.remove();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.update(true);
  }

  show() {
    this.visible = true;
    this.signature = null;
    if (!this.ticker) this.ticker = setInterval(() => this.tick(), 100);
    this.update(true);
  }

  hide() {
    this.visible = false;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.hideLobby();
    this.restoreHints();
    for (const node of [this.root, this.povEl, this.pbEl, this.cueEl, this.downtimeEl, this.practiceEl, this.noticeEl]) node.classList.add("hidden");
    this.timerEl.classList.remove("visible");
    this.signature = null;
  }

  notice(text, ms = 4000) {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.toggle("hidden", !text || !this.visible);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.noticeEl.classList.add("hidden"), ms);
  }

  // ------------------------------------------------------------- lobby (main menu)

  showLobby() {
    const c = this.c;
    if (!c?.state) return;
    clearChildren(this.overlay);
    const box = el("div", { className: "pr-box pr-lobby" }, [el("h2", { text: c.state.name })]);
    this.lobbyEl = el("div");
    box.appendChild(this.lobbyEl);
    box.appendChild(el("div", { className: "pr-buttons" }, [this.button("Hide", () => this.hideLobby()), this.button("Leave the cup", () => c.leaveCup())]));
    this.overlay.appendChild(box);
    this.overlay.classList.remove("hidden");
    this.renderLobby();
  }

  hideLobby() {
    this.overlay.classList.add("hidden");
    clearChildren(this.overlay);
    this.lobbyEl = null;
    this.lobbyCountdownEl = null;
  }

  renderLobby() {
    const c = this.c;
    const state = c?.state;
    if (!this.lobbyEl || !state) return;
    clearChildren(this.lobbyEl);
    const n = state.players.length;
    const rules = state.rules ?? {};
    this.lobbyEl.appendChild(
      el("div", { className: "pr-lobby-status", text: `You are in · ${n} racer${n === 1 ? "" : "s"} · first to ${rules.target ?? state.target} points · new track every ${rules.roundsPerTrack ?? state.roundsPerTrack} rounds${state.track?.name ? ` · next: ${state.track.name}` : ""}` }),
    );
    this.lobbyCountdownEl = el("div", { className: "pr-lobby-countdown", text: this.lobbyCountdownText() });
    this.lobbyEl.appendChild(this.lobbyCountdownEl);
    if (state.standings?.length) {
      const table = el("table");
      for (const s of state.standings) {
        table.appendChild(
          el("tr", { className: s.slot === c.you ? "self" : "" }, [
            el("td", { className: "pr-place", text: s.place != null ? `${s.place}.` : "" }),
            el("td", { text: s.nickname + (s.connected === false ? " (reconnecting)" : "") }),
            el("td", { className: "pr-right", text: `${s.points} pts` }),
          ]),
        );
      }
      this.lobbyEl.appendChild(el("div", { className: "pr-section" }, [table]));
    }
  }

  lobbyCountdownText() {
    const state = this.c?.state;
    if (!state) return "";
    const now = this.serverNow();
    const secs = (at) => Math.max(0, Math.ceil((at - now) / 1000));
    switch (state.phase) {
      case "idle":
        return state.players.length < state.minPlayers ? `${state.players.length}/${state.minPlayers} racers – waiting for more` : "Waiting for racers to load";
      case "break":
        return `${state.round ? "Next round" : "Round 1"} starts in ${secs(state.nextAt)} s`;
      case "complete":
        return `Next cup starts in ${secs(state.nextAt)} s`;
      default:
        return `Round ${state.round} is running – you join the next one`;
    }
  }

  button(text, onClick) {
    return el("button", { className: "button", text, on: { click: onClick } });
  }

  // ------------------------------------------------------------- main panel

  /** Rebuild the panels when something changed (`force` skips the comparison). */
  update(force = false) {
    const c = this.c;
    if (!this.visible || !c?.state) return;
    const state = c.state;
    const live = state.live;
    const rt = c.runtime;
    const key = JSON.stringify([
      this.enabled,
      c.gameStarted,
      c.you,
      state.phase,
      state.round,
      state.trackRounds,
      state.cupNumber,
      state.track?.id,
      state.track?.wr,
      state.track?.tr,
      state.lastTrack?.id,
      state.lastTrack?.tr,
      state.players.map((p) => [p.slot, p.nickname, p.points, p.connected, p.racing, p.pending, p.pb]),
      live && [live.sessionId, live.racers, live.ready, live.warmupReady, live.finishes, live.dnfs, live.splits, live.movement, live.deadline != null],
      state.lastRound && [state.lastRound.round, state.lastRound.points, state.lastRound.movement, state.lastRound.dnfs],
      state.winner?.slot,
      rt && [rt.sessionId, rt.racer, rt.done, rt.retired, rt.warmupReadySent],
      c.view.watchSlot,
      c.view.freecam,
      c.view.following,
      c.mayWatch(),
      c.watchable(),
    ]);
    if (!force && key === this.signature) {
      this.renderLobby();
      return;
    }
    this.signature = key;
    this.renderPanel();
    this.renderPractice();
    this.renderSpectator();
    this.renderLobby();
    this.tick();
  }

  renderPanel() {
    const c = this.c;
    const state = c.state;
    const show = this.enabled && c.gameStarted;
    this.root.classList.toggle("hidden", !show);
    clearChildren(this.root);
    if (!show) return;
    // Between rounds the panel keeps the track just raced (with its record) until the next one loads.
    const track = !["loading", "warmup", "countdown", "racing"].includes(state.phase) && state.lastTrack ? state.lastTrack : state.track;
    const summary = el("div", { className: "prc-summary" });
    const meta = el("div", { className: "prc-meta" }, [el("span", { text: "Random track" }), el("strong", { text: `ROUND ${state.trackRounds || 1}/${state.roundsPerTrack}` })]);
    this.phaseEl = el("span", { text: this.phaseText() });
    const phase = el("div", { className: "prc-phase" }, [this.phaseEl]);
    summary.appendChild(el("div", { className: "prc-track" }, [el("strong", { text: track?.name ?? state.name }), meta, phase]));
    const wr = track?.wr;
    summary.appendChild(this.recordStrip("WR", "prc-wr", !wr ? "Loading…" : wr.status === "ready" ? wr.nickname : wr.status === "unavailable" ? "Unavailable" : "No record", wr?.status === "ready" ? fmtTime(wr.frames) : "—"));
    const tr = track?.tr;
    summary.appendChild(this.recordStrip("TR", "prc-tr", tr ? (tr.nicknames ?? tr.slots?.map((s) => c.playerName(s)) ?? []).join(" / ") : "No record", tr ? fmtTime(tr.frames) : "—"));
    this.root.appendChild(summary);

    const board = el("div", { className: "prc-board" });
    if (state.winner) board.appendChild(el("div", { className: "prc-winner" }, [el("small", { text: "CUP WINNER" }), el("span", { text: state.winner.nickname })]));
    board.appendChild(el("div", { className: "prc-heading" }, [el("strong", { text: state.phase === "racing" ? "ROUND RANKING" : "CUP STANDINGS" })]));
    const rows = standings(state);
    board.classList.toggle("has-movement", rows.some((r) => r.movement !== 0));
    for (const [i, r] of rows.entries()) {
      const row = el("div", { className: `prc-row${r.slot === c.you ? " self" : ""}${r.pending ? " pending" : ""}${r.winner ? " winner" : ""}` });
      row.appendChild(el("strong", { className: "prc-pos", text: String(r.position) }));
      const img = el("img", { className: "prc-car", attrs: { src: this.thumbs.get(r.slot) ?? PLACEHOLDER_CAR, alt: "", draggable: "false" } });
      if (!this.thumbs.has(r.slot)) {
        c.carThumbnail(r.slot).then((url) => {
          if (url) {
            this.thumbs.set(r.slot, url);
            if (img.isConnected) img.src = url;
          }
        });
      }
      const name = el("span", { className: "prc-name" }, [img, el("span", { text: r.nickname + (r.connected ? "" : " (reconnecting)") })]);
      name.title = r.nickname;
      row.appendChild(name);
      const move = el("small", { className: `prc-move ${r.movement < 0 ? "down" : "up"}`, text: r.movement > 0 ? `▲${r.movement}` : r.movement < 0 ? `▼${-r.movement}` : "" });
      row.appendChild(move);
      row.appendChild(el("span", { className: "prc-points" }, [el("strong", { text: String(r.score) }), el("small", { className: r.provisional ? "projected" : "", text: r.gain ? `+${r.gain}` : "" })]));
      const reading = r.frames ?? r.splitFrames;
      const showGap = state.phase === "racing" ? i > 0 && r.delta != null : r.delta != null && r.delta > 0;
      const text = r.dnf ? "DNF" : reading == null ? "—" : showGap ? fmtGap(r.delta ?? 0) : fmtTime(reading);
      const time = el("span", { className: "prc-time", text });
      time.title = r.dnf ? "Retired this round" : r.frames != null ? `Finish: ${fmtTime(r.frames)}` : r.splitFrames != null ? `Checkpoint ${r.checkpoint + 1}: ${fmtTime(r.splitFrames)}` : "";
      row.appendChild(time);
      board.appendChild(row);
    }
    this.root.appendChild(board);
  }

  /** The phase line of the panel, with the countdown of a break. */
  phaseText() {
    const state = this.c?.state;
    if (!state) return "";
    const now = this.serverNow();
    const secs = (at) => Math.max(0, Math.ceil(((at ?? now) - now) / 1000));
    switch (state.phase) {
      case "break":
        return state.nextAt ? `${state.round ? "Next round" : "Round 1"} in ${secs(state.nextAt)}s` : PHASE_NAMES.break;
      case "complete":
        return `Cup over · next cup in ${secs(state.nextAt)}s`;
      case "warmup":
        return state.live?.warmupEndsAt ? `Warmup · ${secs(state.live.warmupEndsAt)}s` : "Warmup";
      default:
        return PHASE_NAMES[state.phase] ?? state.phase;
    }
  }

  recordStrip(label, cls, holder, time) {
    return el("div", { className: `prc-record ${cls}` }, [el("strong", { text: label }), el("span", { className: "prc-holder", text: holder }), el("strong", { className: "prc-rtime", text: time })]);
  }

  renderPractice() {
    const c = this.c;
    const state = c.state;
    const live = state.live;
    const show = this.enabled && c.gameStarted && state.phase === "warmup" && !!live;
    this.practiceEl.classList.toggle("hidden", !show);
    clearChildren(this.practiceEl);
    if (!show) return;
    const racers = live.racers ?? [];
    const ready = live.warmupReady ?? [];
    const rules = state.rules ?? {};
    const box = el("div", { className: "prc-practice-box" });
    box.appendChild(el("span", { text: rules.readyEndsWarmup ? `${ready.length}/${racers.length} ready` : "Warmup" }));
    this.practiceClockEl = el("strong", { text: "" });
    box.appendChild(this.practiceClockEl);
    if (rules.readyEndsWarmup && c.isRacer()) {
      const sent = c.runtime?.warmupReadySent || ready.includes(c.you);
      const btn = el("button", { className: "button prc-ready", text: sent ? "Ready ✓" : "Ready", on: { click: () => c.warmupReady() } });
      btn.disabled = sent;
      box.appendChild(btn);
    }
    this.practiceEl.appendChild(box);
  }

  renderSpectator() {
    const c = this.c;
    const watchable = c.mayWatch() ? c.watchable() : [];
    const show = this.enabled && c.gameStarted && watchable.length > 0 && !c.view.freecam;
    this.povEl.classList.toggle("hidden", !show);
    this.pbEl.classList.toggle("hidden", !show);
    clearChildren(this.povEl);
    clearChildren(this.pbEl);
    if (!show) return;
    const slot = watchable.includes(c.view.watchSlot) ? c.view.watchSlot : watchable[0];
    const prev = el("button", { className: "button prc-pov-cycle", attrs: { title: "Previous racer ([)" }, on: { click: () => c.cycleWatch(-1) } }, [el("span", { className: "prc-arrow left" })]);
    const next = el("button", { className: "button prc-pov-cycle", attrs: { title: "Next racer (])" }, on: { click: () => c.cycleWatch(1) } }, [el("span", { className: "prc-arrow right" })]);
    prev.disabled = next.disabled = watchable.length < 2;
    const main = el("div", { className: "prc-pov-main" }, [el("div", { className: "prc-pov-name", text: c.playerName(slot) })]);
    this.povEl.appendChild(el("div", { className: "prc-pov-box" }, [prev, main, next]));
    const keys = this.freecamKeys();
    this.povEl.appendChild(el("div", { className: "prc-pov-hint", text: `[ ] switch racer${keys ? ` · free camera: ${keys}` : ""}` }));
    const pb = c.pbOf(slot);
    this.pbEl.appendChild(el("span", { text: "PB" }));
    this.pbEl.appendChild(el("strong", { text: pb === undefined ? "Loading…" : pb === null ? "No record" : fmtTime(pb) }));
  }

  freecamKeys() {
    try {
      const c = this.c;
      if (c.rules.allowSpectatorFreecam === false || !c.native || !c.activeGame) return "";
      const settings = c.native.settings(c.activeGame);
      return (settings.getKeyBindings(c.native.KeyBinding.ToggleSpectatorCamera) ?? [])
        .filter(Boolean)
        .map((k) => c.native.keyLabel(k))
        .join(" / ");
    } catch {
      return "";
    }
  }

  // ------------------------------------------------------------- clocks (every 100 ms)

  tick() {
    const c = this.c;
    if (!this.visible || !c?.state) return;
    const state = c.state;
    const live = state.live;
    const now = this.serverNow();
    const inGame = this.enabled && c.gameStarted;
    if (this.lobbyCountdownEl) this.lobbyCountdownEl.textContent = this.lobbyCountdownText();

    // finish window
    const deadline = state.phase === "racing" ? live?.deadline : null;
    const secs = deadline != null ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
    this.timerEl.classList.toggle("visible", inGame && secs !== null);
    if (secs !== null) this.timerEl.textContent = `${secs}s`;

    // 3 2 1 GO
    let cue = "";
    if (inGame && live?.startsAt != null && (state.phase === "countdown" || state.phase === "racing") && c.inLiveSession()) {
      const remaining = live.startsAt - now;
      if (remaining <= 3000 && remaining > -900) cue = remaining > 0 ? String(Math.ceil(remaining / 1000)) : "GO!";
    }
    if (cue !== this.cueValue) {
      this.cueValue = cue;
      this.cueEl.classList.toggle("hidden", !cue);
      this.cueEl.classList.toggle("go", cue === "GO!");
      this.cueEl.textContent = cue;
    }

    // the phase line of the panel ticks (break / warmup countdowns)
    if (this.phaseEl) {
      const phaseText = this.phaseText();
      if (this.phaseEl.textContent !== phaseText) this.phaseEl.textContent = phaseText;
    }
    // centre label: only while nothing of the game's own covers that spot (the results dialog sits there between rounds)
    let label = "";
    if (inGame) {
      if (state.phase === "warmup" && live?.warmupEndsAt) label = `Warmup · ${Math.max(0, Math.ceil((live.warmupEndsAt - now) / 1000))}s`;
      else if (state.phase === "loading") label = state.track?.id && state.track.id !== c.track?.id ? "Changing track…" : "Preparing next round…";
      else if (c.view.freecam) label = "Free camera";
      else if (state.phase === "racing" && c.runtime?.retired && !c.view.following) label = "Retired";
    }
    this.downtimeEl.classList.toggle("hidden", !label);
    if (this.downtimeEl.textContent !== label) this.downtimeEl.textContent = label;

    if (this.practiceClockEl && live?.warmupEndsAt) this.practiceClockEl.textContent = `${Math.max(0, Math.ceil((live.warmupEndsAt - now) / 1000))}s`;
    this.patchHints();
    this.avoidToolbar();
  }

  /** Keep the panel below the game's toolbar when that is showing. */
  avoidToolbar() {
    let top = 0;
    const toolbar = document.querySelector(".game-toolbar-ui > .button-container");
    if (toolbar) {
      const style = getComputedStyle(toolbar);
      const rect = toolbar.getBoundingClientRect();
      if (style.display !== "none" && Number(style.opacity) > 0.01 && rect.width > 0 && rect.left < 440 && rect.top < 200) top = Math.ceil(rect.bottom + 8);
    }
    if (top !== this.toolbarTop) {
      this.toolbarTop = top;
      this.root.style.top = `${top}px`;
    }
  }

  /** The game's "Press T / Backspace to start over." hint: in a live round the key retires. */
  patchHints() {
    const c = this.c;
    const retiring = c.runtime?.racer && c.state?.phase === "racing" && !c.roundDone() && c.raceStarted();
    const root = c.gameInfo?.hud?.element;
    for (const [node, text] of this.hintNodes) {
      if (!retiring || !root?.contains(node)) {
        if (node.textContent === RETIRE_HINT) node.textContent = text;
        this.hintNodes.delete(node);
      }
    }
    if (!retiring || !root) return;
    for (const line of root.querySelectorAll(".hint-ui .title, .hint-ui .subtitle")) {
      for (const node of line.childNodes) {
        if (node.nodeType === 3 && node.textContent === ORIGINAL_HINT) {
          this.hintNodes.set(node, ORIGINAL_HINT);
          node.textContent = RETIRE_HINT;
        }
      }
    }
  }

  restoreHints() {
    for (const [node, text] of this.hintNodes) if (node.textContent === RETIRE_HINT) node.textContent = text;
    this.hintNodes.clear();
  }
}
