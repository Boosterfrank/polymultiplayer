import { test } from "node:test";
import assert from "node:assert/strict";
import { ordinal, formatSignedFrames, formatSpeedDelta } from "../src/ui/splits.js";

test("ordinals like Trackmania's rank badge", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  assert.equal(ordinal(0), "");
  assert.equal(ordinal(null), "");
});

test("time and speed deltas are signed like Trackmania's", () => {
  assert.equal(formatSignedFrames(-168), "-00:00.168");
  assert.equal(formatSignedFrames(1250), "+00:01.250");
  assert.equal(formatSignedFrames(0), "+00:00.000");
  assert.equal(formatSignedFrames(61000), "+01:01.000");
  assert.equal(formatSignedFrames(NaN), "");
  assert.equal(formatSpeedDelta(-1.4), "-1");
  assert.equal(formatSpeedDelta(12.6), "+13");
  assert.equal(formatSpeedDelta(0), "0");
});
