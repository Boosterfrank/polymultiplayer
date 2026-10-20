import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCarBatch, decodeCarBatch, relayFromBatch, decodeCarRelay, peekBatchHeader, formatFrames, BIN } from "../../shared/protocol.js";

test("car batch round trip and relay re-framing", () => {
  const states = [new Uint8Array([1, 2, 3]), new Uint8Array(200).fill(7)];
  const batch = encodeCarBatch(0x01020304, 5, states);
  assert.equal(batch[0], BIN.CAR_UPDATE);
  const decoded = decodeCarBatch(batch);
  assert.equal(decoded.sessionId, 0x01020304);
  assert.equal(decoded.resetCounter, 5);
  assert.equal(decoded.states.length, 2);
  assert.deepEqual([...decoded.states[0]], [1, 2, 3]);
  assert.equal(decoded.states[1].length, 200);

  const header = peekBatchHeader(batch);
  assert.deepEqual(header, { sessionId: 0x01020304, resetCounter: 5, count: 2 });

  const relay = relayFromBatch(9, batch);
  const r = decodeCarRelay(relay);
  assert.equal(r.slot, 9);
  assert.equal(r.sessionId, 0x01020304);
  assert.equal(r.resetCounter, 5);
  assert.deepEqual([...r.states[0]], [1, 2, 3]);
});

test("malformed batches are rejected", () => {
  assert.throws(() => decodeCarBatch(new Uint8Array([1, 0, 0])));
  const batch = encodeCarBatch(1, 1, [new Uint8Array([1])]);
  batch[9] = 2; // claim two states
  assert.throws(() => decodeCarBatch(batch));
  assert.throws(() => encodeCarBatch(1, 1, new Array(65).fill(new Uint8Array(1))));
  assert.throws(() => decodeCarBatch(encodeCarBatch(1, 1, [new Uint8Array(0)])));
});

test("formatFrames matches the game's mm:ss.mmm format", () => {
  assert.equal(formatFrames(null), "---");
  assert.equal(formatFrames(61234), "01:01.234");
  assert.equal(formatFrames(5), "00:00.005");
  assert.equal(formatFrames(-1500), "-00:01.500");
});
