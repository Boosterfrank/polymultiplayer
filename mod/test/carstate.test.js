import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCarState, decodeCarState, normalizeQuaternion } from "../src/carstate.js";

import { sampleState } from "./helpers.js";

test("car state encode/decode round trip", () => {
  const state = sampleState();
  const bytes = encodeCarState(state);
  const { numberOfBytes, carState } = decodeCarState(bytes);
  assert.equal(numberOfBytes, bytes.length);
  assert.deepEqual(carState, state);
});

test("car state without finish frames or contacts", () => {
  const state = sampleState({ finishFrames: null, wheelContact: [null, null, null, null], collisionImpulses: [], hasStarted: false, brakeLightEnabled: false });
  const { carState } = decodeCarState(encodeCarState(state));
  assert.deepEqual(carState, state);
});

test("decoder rejects truncated data", () => {
  const bytes = encodeCarState(sampleState());
  assert.throws(() => decodeCarState(bytes.subarray(0, 20)));
});

test("normalizeQuaternion handles zero and scales", () => {
  assert.deepEqual(normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 }), { x: 0, y: 0, z: 0, w: 1 });
  const q = normalizeQuaternion({ x: 0, y: 0, z: 0, w: 2 });
  assert.equal(q.w, 1);
});
