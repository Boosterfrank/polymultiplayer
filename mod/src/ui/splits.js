import { el, formatFrames } from "../util.js";

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st */
export function ordinal(n) {
  if (!Number.isInteger(n) || n < 1) return "";
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "-00:00.168" / "+00:01.250" like Trackmania's checkpoint delta. */
export function formatSignedFrames(delta) {
  if (!Number.isFinite(delta)) return "";
  return `${delta < 0 ? "-" : "+"}${formatFrames(Math.abs(Math.round(delta)))}`;
}

export function formatSpeedDelta(delta) {
  if (!Number.isFinite(delta)) return "";
  const n = Math.round(delta);
  return `${n > 0 ? "+" : ""}${n}`;
}

/**
 * Trackmania-style checkpoint split: a small box at the top of the screen with the speed (and the
 * speed difference), the rank and the time at the checkpoint, and the time difference to what the
 * split is compared with (green = faster, red = slower). Shown for a couple of seconds.
 */
export class SplitsWidget {
  constructor({ holdMs = 2500 } = {}) {
    this.holdMs = holdMs;
    const ui = document.getElementById("ui") ?? document.body;
    this.root = el("div", { className: "prs-split hidden" });
    this.speedEl = el("span", { className: "prs-speed" });
    this.speedDeltaEl = el("span", { className: "prs-speed-delta" });
    this.rankEl = el("span", { className: "prs-rank" });
    this.timeEl = el("span", { className: "prs-time" });
    this.deltaEl = el("div", { className: "prs-delta" });
    this.speedRow = el("div", { className: "prs-row prs-speed-row" }, [el("span", { className: "prs-car" }), this.speedEl, this.speedDeltaEl]);
    this.root.appendChild(this.speedRow);
    this.root.appendChild(el("div", { className: "prs-row prs-main" }, [this.rankEl, this.timeEl]));
    this.root.appendChild(this.deltaEl);
    ui.appendChild(this.root);
    this.timer = null;
    this.current = null;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.root.remove();
  }

  /**
   * @param {object} split
   * @param {number} split.frames time at the checkpoint
   * @param {number} [split.speed] km/h
   * @param {number|null} [split.speedDelta] km/h faster (+) or slower (−) than the comparison
   * @param {number|null} [split.position] rank at this checkpoint
   * @param {number|null} [split.delta] frames slower (+) or faster (−) than the comparison
   * @param {boolean} [split.pending] rank/delta still to come
   */
  show(split) {
    this.current = split;
    this.update(split);
    this.root.classList.remove("hidden");
    this.root.classList.remove("prs-pop");
    void this.root.offsetWidth; // restart the animation
    this.root.classList.add("prs-pop");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), this.holdMs);
  }

  /** Fill in rank/delta for the split currently shown. */
  update(split) {
    this.current = { ...this.current, ...split };
    const s = this.current;
    const showSpeed = Number.isFinite(s.speed);
    this.speedRow.classList.toggle("hidden", !showSpeed);
    this.speedEl.textContent = showSpeed ? String(Math.round(s.speed)) : "";
    const speedDelta = Number.isFinite(s.speedDelta) ? s.speedDelta : null;
    this.speedDeltaEl.classList.toggle("hidden", speedDelta == null);
    this.speedDeltaEl.textContent = speedDelta == null ? "" : formatSpeedDelta(speedDelta);
    this.speedDeltaEl.classList.toggle("faster", speedDelta != null && speedDelta >= 0);
    this.speedDeltaEl.classList.toggle("slower", speedDelta != null && speedDelta < 0);
    this.rankEl.textContent = s.position ? ordinal(s.position) : s.pending ? "…" : "";
    this.timeEl.textContent = formatFrames(s.frames);
    const delta = Number.isFinite(s.delta) ? s.delta : null;
    this.deltaEl.classList.toggle("hidden", delta == null);
    this.deltaEl.textContent = delta == null ? "" : formatSignedFrames(delta);
    this.deltaEl.classList.toggle("faster", delta != null && delta <= 0);
    this.deltaEl.classList.toggle("slower", delta != null && delta > 0);
  }

  hide() {
    this.root.classList.add("hidden");
    this.current = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
