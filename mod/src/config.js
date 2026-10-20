// Build-time constants (see mod/build.mjs). Fallbacks keep the source importable in tests.
/* global __POLYRANKED_DEFAULT_SERVER__, __POLYRANKED_VERSION__ */
export const DEFAULT_SERVER_URL =
  typeof __POLYRANKED_DEFAULT_SERVER__ !== "undefined" ? __POLYRANKED_DEFAULT_SERVER__ : "ws://localhost:8788";
export const MOD_VERSION = typeof __POLYRANKED_VERSION__ !== "undefined" ? __POLYRANKED_VERSION__ : "0.0.0-dev";
export const MOD_ID = "polyranked";
export const MOD_NAME = "PolyRanked";
export const GAME_VERSION = "0.6.3";
/** How often batched car states are flushed to the server. */
export const CAR_FLUSH_MS = 100;
/** Game mode value of PolyTrack's "Competitive" multiplayer mode (enum `an.Competitive`). */
export const GAME_MODE_COMPETITIVE = 1;
