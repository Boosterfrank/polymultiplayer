import { el, formatSeconds } from "../util.js";
import { TROPHY_SVG } from "./mainmenu.js";

const BOX_CLASS = "polyranked-cup";

/**
 * A big "Join the Cup" box above the game's own multiplayer page (`.multiplayer-ui > .join`),
 * added whenever that page is (re)built. While the page is visible the cup state is refreshed
 * every few seconds through `fetchState()`.
 *
 * @param {object} opts
 * @param {() => void} opts.onJoin
 * @param {() => void} opts.onLeave
 * @param {() => Promise<object|null>} opts.fetchState  `GET /api/cup` (null when unreachable)
 * @param {() => {inCup: boolean, phase: string|null}} opts.localState
 * @param {() => number} opts.serverNow
 * @param {number} [opts.intervalMs]
 * @returns {{dispose(): void, refresh(): void}}
 */
export function installCupButton({ onJoin, onLeave, fetchState, localState, serverNow, intervalMs = 5000 }) {
  const ui = document.getElementById("ui");
  if (!ui) return { dispose() {}, refresh() {} };
  let box = null;
  let state = null; // last /api/cup answer
  let stateAt = 0;
  let unreachable = false;
  let pollTimer = null;
  let tickTimer = null;
  let busy = false;

  // The box is built once; render() only updates texts, so the button stays the same DOM node.
  let titleText = null;
  let statusEl = null;
  let button = null;
  let buttonIcon = null;
  let buttonText = null;
  const build = (body) => {
    titleText = el("span", { text: state?.name ?? "Quickplay Cup" });
    body.appendChild(el("div", { className: "pr-cup-title" }, [el("img", { attrs: { src: TROPHY_SVG, alt: "" } }), titleText]));
    statusEl = el("div", { className: "pr-cup-status" });
    body.appendChild(statusEl);
    buttonIcon = el("img", { className: "button-icon", attrs: { src: "images/play.svg" } });
    buttonText = document.createTextNode("Join the Cup");
    button = el("button", {
      className: "button pr-cup-join",
      on: {
        click: (ev) => {
          ev.preventDefault();
          if (busy) return;
          busy = true;
          setTimeout(() => (busy = false), 1500);
          localState().inCup ? onLeave() : onJoin();
          render();
        },
      },
    });
    button.appendChild(buttonIcon);
    button.appendChild(buttonText);
    body.appendChild(button);
  };

  const render = () => {
    if (!box || !box.isConnected || !button) return;
    const local = localState();
    titleText.textContent = state?.name ?? "Quickplay Cup";
    statusEl.textContent = statusText(local);
    statusEl.classList.toggle("err", !!local.notice);
    buttonIcon.src = local.inCup ? "images/back.svg" : "images/play.svg";
    buttonText.data = local.inCup ? "Leave the cup" : "Join the Cup";
    button.disabled = !!state && state.enabled === false;
  };

  const statusText = (local) => {
    if (local.notice) return local.notice;
    if (local.inCup) {
      if (local.phase === "warmup") return local.racing ? "You are in the cup – warmup" : "You are in the cup – you race from the next round";
      if (local.phase === "racing" || local.phase === "countdown") return local.racing ? "You are in the cup – live round" : "You are in the cup – watching this round, you race the next one";
      if (local.phase === "complete") return "You are in the cup – the next cup starts shortly";
      return "You are in the cup – waiting for the next round";
    }
    if (unreachable && !state) return "Cup server unreachable – check the server address in the Ranked menu";
    if (!state) return "Checking the cup…";
    if (state.enabled === false) return "This server has no cup";
    const n = state.players.length;
    const now = serverNow();
    const leader = state.standings?.[0];
    const lead = leader && leader.points > 0 ? ` · ${leader.nickname} leads with ${leader.points} pts` : "";
    const track = state.track?.name ? ` on ${state.track.name}` : "";
    const roundInfo = `round ${state.round} (${state.trackRounds}/${state.roundsPerTrack})`;
    switch (state.phase) {
      case "idle":
        return n === 0 ? `Always on · nobody racing right now – be the first (first to ${state.target} pts)` : `${n} waiting for racers${track} · ${state.minPlayers} needed to start`;
      case "break":
        return `${n} racing${track} · ${state.round ? `next round in ${formatSeconds((state.nextAt - now) / 1000)}` : `round 1 starts in ${formatSeconds((state.nextAt - now) / 1000)}`}${lead}`;
      case "loading":
      case "warmup":
        return `${n} racing${track} · ${state.phase === "warmup" ? "warmup before" : "loading"} ${roundInfo}${lead} · join now and race this round's successor`;
      case "countdown":
      case "racing":
        return `${n} racing${track} · live ${roundInfo}${lead} · join to watch and race the next round`;
      case "complete":
        return `Cup #${state.cupNumber} won by ${state.lastWinner?.nickname ?? "?"} · next cup starts in ${formatSeconds((state.nextAt - now) / 1000)}`;
      default:
        return `${n} in the cup`;
    }
  };

  const poll = async () => {
    try {
      const next = await fetchState();
      if (next) {
        state = next;
        stateAt = Date.now();
        unreachable = false;
      } else unreachable = true;
    } catch {
      unreachable = true;
    }
    render();
  };

  const tryInject = () => {
    const join = ui.querySelector(".multiplayer-ui > .join");
    if (!join) {
      if (box) {
        box = null;
        stopPolling();
      }
      return;
    }
    if (join.querySelector("." + BOX_CLASS)) return;
    const body = el("div", { className: "pr-cup-body" });
    box = el("div", { className: BOX_CLASS }, [body]);
    build(body);
    join.insertBefore(box, join.firstChild);
    render();
    startPolling();
  };

  const startPolling = () => {
    stopPolling();
    poll();
    pollTimer = setInterval(poll, intervalMs);
    tickTimer = setInterval(render, 1000);
  };
  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    pollTimer = tickTimer = null;
  };

  const observer = new MutationObserver(() => tryInject());
  observer.observe(ui, { childList: true, subtree: true });
  tryInject();
  return {
    dispose() {
      observer.disconnect();
      stopPolling();
      box?.remove();
      box = null;
    },
    refresh() {
      render();
    },
    /** Push a fresh state (welcome.cup, cup_state) without waiting for the next poll. */
    setState(next) {
      if (!next) return;
      state = next;
      stateAt = Date.now();
      unreachable = false;
      render();
    },
    /** @returns {number} age of the cached state in ms */
    get stateAge() {
      return Date.now() - stateAt;
    },
  };
}
