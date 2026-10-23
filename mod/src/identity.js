import { DEFAULT_SERVER_URL, LEGACY_DEFAULT_SERVER_URL } from "./config.js";

const KEY_SECRET = "polyranked.secret";
const KEY_SETTINGS = "polyranked.settings";

export const DEFAULT_SETTINGS = Object.freeze({
  serverUrl: DEFAULT_SERVER_URL,
  nameOverride: "",
  autoConnect: true,
  showHud: true,
});

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable per-browser secret identifying this player on the ranked server. */
export function getSecret() {
  const s = storage();
  let secret = s?.getItem(KEY_SECRET);
  if (!secret || secret.length < 32) {
    secret = randomHex(32);
    s?.setItem(KEY_SECRET, secret);
  }
  return secret;
}

export function loadSettings() {
  const s = storage();
  try {
    const raw = s?.getItem(KEY_SETTINGS);
    const parsed = raw ? JSON.parse(raw) : {};
    const settings = { ...DEFAULT_SETTINGS, ...parsed };
    // settings saved by an earlier build with the localhost placeholder follow the current default
    if (!settings.serverUrl || settings.serverUrl === LEGACY_DEFAULT_SERVER_URL) settings.serverUrl = DEFAULT_SERVER_URL;
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const s = storage();
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  s?.setItem(KEY_SETTINGS, JSON.stringify(merged));
  return merged;
}

/** Normalize what the user typed into a WebSocket URL. */
export function normalizeServerUrl(input) {
  let url = String(input ?? "").trim();
  if (!url) return DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, "ws");
  if (!/^wss?:\/\//i.test(url)) url = (url.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(url) ? "ws://" : "wss://") + url;
  return url.replace(/\/+$/, "");
}
