// Build-time constants (see mod/build.mjs). Fallbacks keep the source importable in tests.
/* global __POLYRANKED_DEFAULT_SERVER__, __POLYRANKED_VERSION__ */
/** Server baked into the mod; the build overrides it with POLYRANKED_DEFAULT_SERVER. */
export const DEFAULT_SERVER_URL =
  typeof __POLYRANKED_DEFAULT_SERVER__ !== "undefined" ? __POLYRANKED_DEFAULT_SERVER__ : "wss://hydrogen-granted-distributors-pos.trycloudflare.com";
/** Earlier builds shipped this placeholder; settings still holding it follow the current default. */
export const LEGACY_DEFAULT_SERVER_URL = "ws://localhost:8788";
/** The Ranked main-menu button is hidden for now; F7 and the Join the Cup box still reach everything. */
export const SHOW_MENU_BUTTON = false;
export const MOD_VERSION = typeof __POLYRANKED_VERSION__ !== "undefined" ? __POLYRANKED_VERSION__ : "0.0.0-dev";
export const MOD_ID = "polyranked";
export const MOD_NAME = "PolyRanked";
export const GAME_VERSION = "0.6.3";
/** How often batched car states are flushed to the server. */
export const CAR_FLUSH_MS = 100;
/** Game mode value of PolyTrack's "Competitive" multiplayer mode (enum `an.Competitive`). */
export const GAME_MODE_COMPETITIVE = 1;
