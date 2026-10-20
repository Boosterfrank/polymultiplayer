export { formatFrames } from "../../shared/protocol.js";

export const LOG_PREFIX = "[PolyRanked]";

export const log = {
  info: (...a) => console.log(LOG_PREFIX, ...a),
  warn: (...a) => console.warn(LOG_PREFIX, ...a),
  error: (...a) => console.error(LOG_PREFIX, ...a),
};

/**
 * Small DOM helper.
 * @param {string} tag
 * @param {object} [props] className, text, html, style (object), on (event map), attrs (attribute map), dataset
 * @param {Array<Node|string|null|undefined|false>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text != null) node.textContent = props.text;
  if (props.html != null) node.innerHTML = props.html;
  if (props.style) Object.assign(node.style, props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) if (v != null) node.setAttribute(k, String(v));
  if (props.on) for (const [k, v] of Object.entries(props.on)) node.addEventListener(k, v);
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v;
  for (const child of children) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** "1:23" style for countdowns / wait timers. */
export function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Tiny typed event emitter (EventTarget works in browsers and Node 18+). */
export class Emitter {
  constructor() {
    this._target = new EventTarget();
  }
  on(type, handler) {
    const wrapped = (ev) => handler(ev.detail);
    this._target.addEventListener(type, wrapped);
    return () => this._target.removeEventListener(type, wrapped);
  }
  once(type, handler) {
    const off = this.on(type, (detail) => {
      off();
      handler(detail);
    });
    return off;
  }
  emit(type, detail) {
    this._target.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export function safe(fn, label = "callback") {
  try {
    return fn();
  } catch (err) {
    log.error(`${label} failed`, err);
    return undefined;
  }
}
