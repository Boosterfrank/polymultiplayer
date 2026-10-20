import { test } from "node:test";
import assert from "node:assert/strict";
import { RankedConnection, FrameTime } from "../src/connection.js";
import { encodeCarState } from "../src/carstate.js";
import { MSG, decodeCarBatch, encodeCarRelay } from "../../shared/protocol.js";
import { sampleState } from "./helpers.js";

class FakeClient {
  constructor() {
    this.sent = [];
    this.binary = [];
    this.rtt = 33;
  }
  send(obj) {
    this.sent.push(obj);
  }
  sendBinary(bytes) {
    this.binary.push(bytes);
  }
  ofType(type) {
    return this.sent.filter((m) => m.type === type);
  }
}

const players = [
  { slot: 1, nickname: "Me", countryCode: "SE", carStyle: null, team: 0 },
  { slot: 2, nickname: "Opp", countryCode: null, carStyle: null, team: 1 },
];

function make(extra = {}) {
  const client = new FakeClient();
  const events = { disposed: 0, attached: [] };
  const conn = new RankedConnection({
    client,
    matchSlot: 1,
    players,
    flushIntervalMs: 0,
    onDispose: () => events.disposed++,
    onAttached: (id) => events.attached.push(id),
    ...extra,
  });
  return { client, conn, events };
}

test("getPlayers marks self and clones records", () => {
  const { conn } = make();
  const list = conn.getPlayers();
  assert.equal(list.length, 2);
  assert.equal(list.find((p) => p.id === 1).isSelf, true);
  assert.equal(list.find((p) => p.id === 2).isSelf, false);
  assert.equal(conn.getMaxPlayers(), 2);
  assert.equal(conn.isInviteAllowed(), false);
  conn.setRecords({ 2: 45000 });
  const opp = conn.getPlayers().find((p) => p.id === 2);
  assert.equal(opp.record.numberOfFrames, 45000);
  assert.ok(opp.record instanceof FrameTime);
  assert.notEqual(opp.record, conn.players.get(2).record); // cloned
  assert.equal(conn.getPing(1), 33);
  conn.setPings({ 2: 80 });
  assert.equal(conn.getPing(2), 80);
});

test("session callbacks follow the game's semantics", () => {
  const { conn, events } = make();
  const track = { trackMetadata: { name: "T" }, trackData: {} };
  const newSessions = [];
  conn.addNewSessionCallback(null, (...args) => newSessions.push(args));
  conn.startSession(1001, track);
  assert.equal(newSessions.length, 1);
  assert.deepEqual(newSessions[0], [1001, 1, track.trackMetadata, track.trackData]);

  // registering an end-session callback for the current (running) session reports "attached"
  let ended = 0;
  conn.addEndSessionCallback(1001, () => ended++);
  assert.equal(ended, 0);
  assert.deepEqual(events.attached, [1001]);

  // for a stale session the callback fires immediately (the game then shows results)
  conn.addEndSessionCallback(999, () => ended++);
  assert.equal(ended, 1);

  // a new-session callback registered for an old session fires right away with the current one
  const late = [];
  conn.addNewSessionCallback(999, (...args) => late.push(args));
  assert.equal(late.length, 1);
  assert.equal(late[0][0], 1001);

  // ending the session fires every registered callback (the game registers one per state)
  conn.endSession(1001);
  assert.equal(ended, 3);
  conn.endSession(1001); // idempotent
  assert.equal(ended, 3);
  conn.addEndSessionCallback(1001, () => ended++); // already ended -> immediate
  assert.equal(ended, 4);

  // players changed fires with the session id
  const changed = [];
  conn.addPlayersChangedCallback((id) => changed.push(id));
  conn.setRecords({ 1: 1000 });
  assert.deepEqual(changed, [1001]);
});

test("car updates are batched per reset counter and sent as binary", () => {
  const { conn, client } = make();
  conn.startSession(5, { trackMetadata: {}, trackData: {} });
  const s1 = sampleState({ frames: 10 });
  const s2 = sampleState({ frames: 20 });
  conn.sendCarUpdate(5, 0, s1);
  conn.sendCarUpdate(5, 0, s2);
  conn.sendCarUpdate(6, 0, s2); // wrong session ignored
  assert.equal(client.binary.length, 0);
  conn.flush();
  assert.equal(client.binary.length, 1);
  const batch = decodeCarBatch(client.binary[0]);
  assert.equal(batch.sessionId, 5);
  assert.equal(batch.resetCounter, 0);
  assert.equal(batch.states.length, 2);
  assert.deepEqual([...batch.states[0]], [...encodeCarState(s1)]);

  conn.sendCarUpdate(5, 0, s1);
  conn.sendCarReset(5, 1); // flushes pending states and sends the reset message
  assert.equal(client.binary.length, 2);
  assert.deepEqual(client.ofType(MSG.CAR_RESET)[0], { type: MSG.CAR_RESET, sessionId: 5, resetCounter: 1 });
  conn.sendCarUpdate(5, 1, s2);
  conn.flush();
  assert.equal(decodeCarBatch(client.binary[2]).resetCounter, 1);
});

test("sendRecord updates own record and notifies the server; relays reach car callbacks", () => {
  const { conn, client } = make();
  conn.startSession(7, { trackMetadata: {}, trackData: {} });
  conn.sendRecord(7, new FrameTime(42000));
  assert.deepEqual(client.ofType(MSG.RECORD), [{ type: MSG.RECORD, sessionId: 7, frames: 42000 }]);
  assert.equal(conn.getPlayers().find((p) => p.isSelf).record.numberOfFrames, 42000);
  conn.sendRecord(8, new FrameTime(1)); // wrong session
  assert.equal(client.ofType(MSG.RECORD).length, 1);

  const updates = [];
  conn.addCarUpdateCallback((...args) => updates.push(args));
  const state = sampleState({ frames: 500, quaternion: { x: 0, y: 0, z: 0, w: 2 } });
  conn.handleRelay(encodeCarRelay(2, 7, 3, [encodeCarState(state)]));
  assert.equal(updates.length, 1);
  const [sessionId, slot, resetCounter, decoded] = updates[0];
  assert.deepEqual([sessionId, slot, resetCounter], [7, 2, 3]);
  assert.equal(decoded.frames, 500);
  assert.equal(decoded.quaternion.w, 1); // normalized
  conn.handleRelay(encodeCarRelay(1, 7, 0, [encodeCarState(state)])); // own slot ignored
  conn.handleRelay(encodeCarRelay(2, 8, 0, [encodeCarState(state)])); // other session ignored
  assert.equal(updates.length, 1);

  const resets = [];
  conn.addCarResetCallback((...args) => resets.push(args));
  conn.handleCarReset(7, 2, 4);
  assert.deepEqual(resets, [[7, 2, 4]]);
});

test("dispose and connection loss", () => {
  const { conn, events } = make();
  const lost = [];
  conn.addConnectionLostCallback((r) => lost.push(r));
  conn.connectionLost("disconnected");
  assert.deepEqual(lost, ["disconnected"]);
  conn.addConnectionLostCallback((r) => lost.push("late:" + r));
  assert.deepEqual(lost, ["disconnected", "late:disconnected"]);
  conn.dispose();
  conn.dispose();
  assert.equal(events.disposed, 1);
  assert.equal(conn.disposed, true);
});

test("players can be removed; self never removed", () => {
  const { conn } = make();
  conn.removePlayer(1);
  assert.equal(conn.getPlayers().length, 2);
  conn.removePlayer(2);
  assert.equal(conn.getPlayers().length, 1);
  conn.setPlayers([...players, { slot: 3, nickname: "New", team: 1 }]);
  assert.equal(conn.getPlayers().length, 3);
});
