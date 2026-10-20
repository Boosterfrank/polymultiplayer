// Shared between the PolyRanked server (Node.js) and the PML mod (browser).
// Plain ES module, no dependencies.

export const PROTOCOL_VERSION = 1;
export const GAME_VERSION = "0.6.3";

/** JSON message types (`type` field). */
export const MSG = Object.freeze({
  // client -> server
  HELLO: "hello",
  QUEUE_JOIN: "queue_join",
  QUEUE_LEAVE: "queue_leave",
  MATCH_READY: "match_ready",
  RECORD: "record",
  CAR_RESET: "car_reset",
  LEAVE_MATCH: "leave_match",
  PING: "ping",
  LEADERBOARD_GET: "leaderboard_get",
  // server -> client
  WELCOME: "welcome",
  ERROR: "error",
  QUEUE_STATUS: "queue_status",
  MATCH_FOUND: "match_found",
  MATCH_RESUME: "match_resume",
  ROUND_START: "round_start",
  ROUND_CLOCK: "round_clock",
  RECORDS: "records",
  ROUND_END: "round_end",
  MATCH_END: "match_end",
  PLAYER_LEFT: "player_left",
  PLAYER_STATUS: "player_status",
  PINGS: "pings",
  SERVER_MESSAGE: "server_message",
  PONG: "pong",
  LEADERBOARD: "leaderboard",
  PROFILE: "profile",
});

/** First byte of binary frames. */
export const BIN = Object.freeze({
  CAR_UPDATE: 1, // client -> server
  CAR_UPDATE_RELAY: 2, // server -> client (prefixed with the sender slot)
});

export const MAX_STATES_PER_BATCH = 64;
export const MAX_STATE_BYTES = 512;

const HEADER_BATCH = 1 + 4 + 4 + 2;

/**
 * client -> server: `u8 type | u32 sessionId | u32 resetCounter | u16 count | {u16 len, bytes}*`
 * @param {number} sessionId
 * @param {number} resetCounter
 * @param {Uint8Array[]} states serialized car states (opaque to the server)
 */
export function encodeCarBatch(sessionId, resetCounter, states) {
  if (states.length > MAX_STATES_PER_BATCH) {
    throw new Error("Too many car states in one batch");
  }
  let total = HEADER_BATCH;
  for (const s of states) total += 2 + s.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out[0] = BIN.CAR_UPDATE;
  dv.setUint32(1, sessionId >>> 0, true);
  dv.setUint32(5, resetCounter >>> 0, true);
  dv.setUint16(9, states.length, true);
  let o = HEADER_BATCH;
  for (const s of states) {
    dv.setUint16(o, s.length, true);
    o += 2;
    out.set(s, o);
    o += s.length;
  }
  return out;
}

function readStates(bytes, dv, offset, count) {
  const states = [];
  let o = offset;
  for (let i = 0; i < count; i++) {
    if (o + 2 > bytes.length) throw new Error("Truncated car batch");
    const len = dv.getUint16(o, true);
    o += 2;
    if (len === 0 || len > MAX_STATE_BYTES || o + len > bytes.length) {
      throw new Error("Invalid car state length");
    }
    states.push(bytes.subarray(o, o + len));
    o += len;
  }
  if (o !== bytes.length) throw new Error("Leftover data in car batch");
  return states;
}

/** @returns {{sessionId:number, resetCounter:number, states:Uint8Array[]}} */
export function decodeCarBatch(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < HEADER_BATCH || bytes[0] !== BIN.CAR_UPDATE) {
    throw new Error("Not a car batch");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sessionId = dv.getUint32(1, true);
  const resetCounter = dv.getUint32(5, true);
  const count = dv.getUint16(9, true);
  if (count > MAX_STATES_PER_BATCH) throw new Error("Too many car states");
  return { sessionId, resetCounter, states: readStates(bytes, dv, HEADER_BATCH, count) };
}

/**
 * server -> client: `u8 type | u8 slot | u32 sessionId | u32 resetCounter | u16 count | {u16 len, bytes}*`
 */
export function encodeCarRelay(slot, sessionId, resetCounter, states) {
  const batch = encodeCarBatch(sessionId, resetCounter, states);
  return relayFromBatch(slot, batch);
}

/** Fast path used by the server: re-frame a validated batch without touching the states. */
export function relayFromBatch(slot, batchBytes) {
  const out = new Uint8Array(batchBytes.length + 1);
  out[0] = BIN.CAR_UPDATE_RELAY;
  out[1] = slot & 0xff;
  out.set(batchBytes.subarray(1), 2);
  return out;
}

/** @returns {{slot:number, sessionId:number, resetCounter:number, states:Uint8Array[]}} */
export function decodeCarRelay(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length < HEADER_BATCH + 1 || bytes[0] !== BIN.CAR_UPDATE_RELAY) {
    throw new Error("Not a car relay frame");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slot = bytes[1];
  const sessionId = dv.getUint32(2, true);
  const resetCounter = dv.getUint32(6, true);
  const count = dv.getUint16(10, true);
  if (count > MAX_STATES_PER_BATCH) throw new Error("Too many car states");
  return { slot, sessionId, resetCounter, states: readStates(bytes, dv, HEADER_BATCH + 1, count) };
}

/** Peek the session id of a client batch without full validation (server hot path). */
export function peekBatchHeader(bytes) {
  if (bytes.length < HEADER_BATCH || bytes[0] !== BIN.CAR_UPDATE) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    sessionId: dv.getUint32(1, true),
    resetCounter: dv.getUint32(5, true),
    count: dv.getUint16(9, true),
  };
}

/** Format a time given in game frames (milliseconds) as the game does: mm:ss.mmm */
export function formatFrames(frames) {
  if (frames == null) return "---";
  const n = Math.abs(frames);
  const minutes = Math.floor(n / 60000);
  const seconds = Math.floor((n - minutes * 60000) / 1000);
  const millis = n - minutes * 60000 - seconds * 1000;
  return (
    (frames < 0 ? "-" : "") +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "." +
    String(millis).padStart(3, "0")
  );
}
