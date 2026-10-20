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
    this.root.classList.add("hidden");
    this.overlay.classList.add("hidden");
    clearChildren(this.overlay);
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

  render() {
    if (!this.match) return;
    clearChildren(this.root);
    const f = this.match.format;
    const roundsInfo = f.roundsToWin ? `first to ${f.roundsToWin}` : `of ${f.maxRounds}`;
    this.root.appendChild(
      el("div", { className: "pr-card" }, [
        el("div", { className: "pr-title" }, [el("span", { text: this.match.queueName }), el("span", { text: this.round ? `Round ${this.round} · ${roundsInfo}` : "Loading…" })]),
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
    if (!this.timerEl || !this.match) return;
    const now = this.serverNow();
    if (!this.round) {
      this.timerEl.textContent = "";
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
}
