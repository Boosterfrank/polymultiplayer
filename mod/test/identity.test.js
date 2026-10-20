import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeServerUrl, loadSettings, getSecret, DEFAULT_SETTINGS } from "../src/identity.js";

test("normalizeServerUrl", () => {
  assert.equal(normalizeServerUrl("ranked.example.com"), "wss://ranked.example.com");
  assert.equal(normalizeServerUrl("http://ranked.example.com/"), "ws://ranked.example.com");
  assert.equal(normalizeServerUrl("https://ranked.example.com"), "wss://ranked.example.com");
  assert.equal(normalizeServerUrl("localhost:8788"), "ws://localhost:8788");
  assert.equal(normalizeServerUrl("192.168.1.2:8788"), "ws://192.168.1.2:8788");
  assert.equal(normalizeServerUrl("wss://x.y/z/"), "wss://x.y/z");
  assert.equal(normalizeServerUrl(""), DEFAULT_SETTINGS.serverUrl);
});

test("settings and secret work without localStorage (node)", () => {
  assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS });
  const s = getSecret();
  assert.equal(s.length, 64);
  assert.match(s, /^[0-9a-f]+$/);
});
