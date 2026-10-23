import { el, clearChildren, formatFrames, formatSeconds } from "../util.js";

/** In-match scoreboard, timer, round results and match summary. */
export class MatchHud {
  constructor({ serverNow }) {
    this.serverNow = serverNow;
    this.root = el("div", { className: "polyranked-hud hidden" });
    this.overlay = el("div", { className: "polyranked-overlay hidden" });
    const ui = document.getElementById("ui");
    ui?.appendChild(this.root);
    ui?.appendChild(this.overlay);
    this.match = null;
    this.you = null;
    this.round = 0;
    this.startsAt = 0;
    this.endsAt = 0;
    this.scores = null;
    this.records = {};
    this.toast = null;
    this._toastTimer = null;
    this._timer = null;
    this.enabled = true;
    this.cup = null;
    this.lobbyEl = null;
    this.lobbyCountdownEl = null;
  }

  dispose() {
    this.stopTimer();
    this.root.remove();
    this.overlay.remove();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.root.classList.add("hidden");
    else if (this.match) this.root.classList.remove("hidden");
  }

  show(match, you) {
    this.match = match;
    this.you = you;
    this.round = 0;
    this.scores = null;
    this.records = {};
    if (this.enabled) this.root.classList.remove("hidden");
    this.render();
    this.startTimer();
  }

  hide() {
    this.match = null;
    this.cup = null;
    this.root.classList.add("hidden");
    this.hideOverlay();
    this.stopTimer();
  }

  startTimer() {
    this.stopTimer();
    this._timer = setInterval(() => this.renderTimer(), 250);
  }

  stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  setPlayers(players) {
    if (this.match) this.match.players = players;
    this.render();
  }

  setRound(round, startsAt, endsAt, scores) {
    this.round = round;
    this.startsAt = startsAt;
    this.endsAt = endsAt;
    if (scores) this.scores = scores;
    this.records = {};
    this.render();
  }

  setEndsAt(endsAt) {
    this.endsAt = endsAt;
    this.renderTimer();
  }

  setRecords(records) {
    this.records = records ?? {};
    this.render();
  }

  setScores(scores) {
    this.scores = scores;
    this.render();
  }

  showToast(text, ms = 4000) {
    this.toast = text;
    this.render();
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast = null;
      this.render();
    }, ms);
  }

  // ------------------------------------------------------------- helpers

  me() {
    return this.match?.players.find((p) => p.slot === this.you) ?? null;
  }

  teamLabel(team) {
    return team === 0 ? "Blue" : "Red";
  }

  scoreHeadline() {
    const f = this.match?.format;
    if (!f || !this.scores) return "";
    if (f.scoring === "duel" || f.scoring === "teams") {
      const rw = this.scores.roundWins ?? [0, 0];
      const myTeam = this.me()?.team ?? 0;
      return `${rw[myTeam]} – ${rw[1 - myTeam]}`;
    }
    const pts = this.scores.points ?? {};
    return `${pts[this.you] ?? 0} pts`;
  }

  // ------------------------------------------------------------- rendering

  roundLabel() {
    const f = this.match.format;
    if (f.cup) {
      if (!this.round) return this.cup?.phase === "idle" ? "Waiting for racers" : "Waiting for the next round";
      const block = this.cup?.roundsPerTrack ? ` (${this.cup.trackRounds}/${this.cup.roundsPerTrack})` : "";
      return `Round ${this.round}${block} · first to ${f.target}`;
    }
    if (!this.round) return "Loading…";
    return `Round ${this.round} · ${f.roundsToWin ? `first to ${f.roundsToWin}` : `of ${f.maxRounds}`}`;
  }

  /** Cup lobby details (from cup_state / round_start) shown in the card and the lobby overlay. */
  setCup(cup) {
    this.cup = cup;
    if (cup?.players) this.setPlayers(cup.players);
    else this.render();
    if (this.lobbyEl) this.renderLobby();
  }

  render() {
    if (!this.match) return;
    clearChildren(this.root);
    const f = this.match.format;
    this.root.appendChild(
      el("div", { className: "pr-card" }, [
        el("div", { className: "pr-title" }, [el("span", { text: this.match.queueName }), el("span", { text: this.roundLabel() })]),
        el("div", { className: "pr-score" }, [el("span", { text: this.scoreHeadline() }), (this.timerEl = el("span", { className: "pr-timer" }))]),
      ]),
    );
    const list = el("div", { className: "pr-card pr-list" });
    const players = [...this.match.players].sort((a, b) => {
      const ra = this.records[a.slot];
      const rb = this.records[b.slot];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return a.slot - b.slot;
    });
    for (const p of players) {
      const cls = ["pr-line", p.slot === this.you ? "self" : "", p.team != null ? `t${p.team}` : ""].join(" ");
      const points = this.scores?.points?.[p.slot] ?? 0;
      list.appendChild(
        el("div", { className: cls }, [
          el("span", {}, [p.team != null ? el("span", { className: "pr-team", text: "■ " }) : null, p.nickname + (p.active === false ? " (left)" : "")]),
          el("span", { text: `${formatFrames(this.records[p.slot] ?? null)}${f.scoring === "points" || f.scoring === "teams" ? ` · ${points}` : ""}` }),
        ]),
      );
    }
    this.root.appendChild(list);
    if (this.toast) this.root.appendChild(el("div", { className: "pr-card pr-toast", text: this.toast }));
    this.renderTimer();
  }

  renderTimer() {
    if (this.lobbyCountdownEl) this.lobbyCountdownEl.textContent = this.lobbyCountdownText();
    if (!this.timerEl || !this.match) return;
    const now = this.serverNow();
    if (!this.round) {
      const nextAt = this.cup?.nextAt;
      this.timerEl.textContent = nextAt && nextAt > now ? `in ${Math.ceil((nextAt - now) / 1000)}` : "";
      return;
    }
    if (now < this.startsAt) {
      this.timerEl.textContent = `GO in ${Math.ceil((this.startsAt - now) / 1000)}`;
      this.timerEl.classList.remove("warn");
    } else {
      const left = Math.max(0, this.endsAt - now);
      this.timerEl.textContent = formatSeconds(left / 1000);
      this.timerEl.classList.toggle("warn", left < 10000);
    }
  }

  /** Full-screen match summary with rating changes. */
  showMatchEnd({ winner, reason, scores, ratings, players }, { onBackToMenu, onQueueAgain }) {
    clearChildren(this.overlay);
    const me = players.find((p) => p.slot === this.you);
    const myResult = ratings?.[this.you]?.result ?? "draw";
    const headline = myResult === "win" ? "VICTORY" : myResult === "loss" ? "DEFEAT" : "DRAW";
    const box = el("div", { className: "pr-box" }, [el("h2", { text: "Match over" }), el("div", { className: "pr-result " + myResult, text: headline })]);
    const reasonText = reason === "forfeit" ? "Opponents left the match" : reason === "draw" ? "The match ended in a draw" : winner?.type === "team" && me?.team != null ? `${this.teamLabel(winner.team)} team wins` : "";
    if (reasonText) box.appendChild(el("div", { className: "pr-section", text: reasonText }));

    const table = el("table");
    const sorted = [...players].sort((a, b) => (scores?.points?.[b.slot] ?? 0) - (scores?.points?.[a.slot] ?? 0));
    for (const p of sorted) {
      const r = ratings?.[p.slot];
      const delta = r ? (r.delta >= 0 ? `+${r.delta}` : `${r.delta}`) : "";
      table.appendChild(
        el("tr", { className: p.slot === this.you ? "self" : "" }, [
          el("td", { text: (p.team != null ? `[${this.teamLabel(p.team)}] ` : "") + p.nickname }),
          el("td", { text: `${scores?.points?.[p.slot] ?? 0} pts` }),
          el("td", { text: r ? `${r.after}` : "" }),
          el("td", { className: "pr-delta " + (r && r.delta >= 0 ? "up" : "down"), text: delta }),
          el("td", { text: r?.division ?? "" }),
        ]),
      );
    }
    box.appendChild(el("div", { className: "pr-section" }, [table]));
    box.appendChild(
      el("div", { className: "pr-buttons" }, [
        this.button("Back to menu", onBackToMenu),
        this.button("Queue again", onQueueAgain),
      ]),
    );
    this.overlay.appendChild(box);
    this.overlay.classList.remove("hidden");
  }

  button(text, onClick) {
    return el("button", { className: "button", text, on: { click: onClick } });
  }

  hideOverlay() {
    this.overlay.classList.add("hidden");
    clearChildren(this.overlay);
    this.lobbyEl = null;
    this.lobbyCountdownEl = null;
  }

  // ------------------------------------------------------------- cup

  standingsTable(standings, { showPlace = true } = {}) {
    const table = el("table");
    for (const s of standings) {
      table.appendChild(
        el("tr", { className: s.slot === this.you ? "self" : "" }, [
          showPlace ? el("td", { className: "pr-place", text: s.place != null ? `${s.place}.` : "" }) : null,
          el("td", { text: s.nickname + (s.connected === false ? " (reconnecting)" : "") }),
          el("td", { className: "pr-right", text: `${s.points} pts` }),
        ]),
      );
    }
    return table;
  }

  lobbyCountdownText() {
    const cup = this.cup;
    if (!cup) return "";
    const now = this.serverNow();
    if (cup.phase === "idle") return cup.players.length < cup.minPlayers ? `${cup.players.length}/${cup.minPlayers} racers – waiting for more` : "Waiting for racers to load";
    const at = cup.phase === "starting" || cup.phase === "results" || cup.phase === "complete" ? cup.nextAt : cup.startsAt;
    if (!at) return "";
    const secs = Math.max(0, Math.ceil((at - now) / 1000));
    if (cup.phase === "complete") return `Next cup starts in ${secs} s`;
    if (cup.phase === "countdown" || cup.phase === "racing" || cup.phase === "closing") return `Round ${cup.round} is running – you join the next one`;
    return `${cup.round ? "Next round" : "Round 1"} starts in ${secs} s`;
  }

  /** Lobby overlay while waiting for the next round (in the menu). */
  showCupLobby(cup, { onLeave, onHide }) {
    this.cup = cup;
    clearChildren(this.overlay);
    const box = el("div", { className: "pr-box pr-lobby" }, [el("h2", { text: cup.name })]);
    this.lobbyEl = el("div");
    box.appendChild(this.lobbyEl);
    box.appendChild(el("div", { className: "pr-buttons" }, [this.button("Hide", onHide), this.button("Leave the cup", onLeave)]));
    this.overlay.appendChild(box);
    this.overlay.classList.remove("hidden");
    this.renderLobby();
  }

  renderLobby() {
    if (!this.lobbyEl || !this.cup) return;
    const cup = this.cup;
    clearChildren(this.lobbyEl);
    this.lobbyEl.appendChild(el("div", { className: "pr-lobby-status", text: `You are in · ${cup.players.length} racer${cup.players.length === 1 ? "" : "s"} · first to ${cup.target} points · new track every ${cup.roundsPerTrack} rounds${cup.track?.name ? ` · now: ${cup.track.name}` : ""}` }));
    this.lobbyCountdownEl = el("div", { className: "pr-lobby-countdown", text: this.lobbyCountdownText() });
    this.lobbyEl.appendChild(this.lobbyCountdownEl);
    if (cup.standings?.length) this.lobbyEl.appendChild(el("div", { className: "pr-section" }, [this.standingsTable(cup.standings)]));
  }

  /** Cup over: winner and final standings, the next cup starts by itself. */
  showCupEnd(msg, { onLeave, onHide }) {
    clearChildren(this.overlay);
    const won = msg.winner?.slot === this.you;
    const box = el("div", { className: "pr-box" }, [
      el("h2", { text: `Cup #${msg.cupNumber} over` }),
      el("div", { className: "pr-result " + (won ? "win" : "loss"), text: won ? "YOU WIN THE CUP!" : `${msg.winner?.nickname ?? "?"} wins the cup` }),
      el("div", { className: "pr-section" }, [this.standingsTable(msg.standings ?? [])]),
    ]);
    this.lobbyCountdownEl = el("div", { className: "pr-lobby-countdown", text: this.lobbyCountdownText() });
    box.appendChild(this.lobbyCountdownEl);
    box.appendChild(el("div", { className: "pr-buttons" }, [this.button("Stay for the next cup", onHide), this.button("Leave the cup", onLeave)]));
    this.overlay.appendChild(box);
    this.overlay.classList.remove("hidden");
  }
}
