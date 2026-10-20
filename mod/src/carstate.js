/**
 * Binary codec for PolyTrack car states (port of the game's own multiplayer serializer, 0.6.3).
 * The decoded object has exactly the shape the game's in-game state expects.
 */

export function encodeCarState(e) {
  let t = 0;
  t += 3; // frames (u24)
  t += 4; // speedKmh
  t += 1; // flags
  if (e.finishFrames != null) t += 3;
  t += 2; // nextCheckpointIndex
  t += 12; // position
  t += 16; // quaternion
  t += 1 + 4 * e.collisionImpulses.length;
  for (const c of e.wheelContact) if (c != null) t += 24;
  t += 16 * 4; // wheel arrays
  t += 4; // steering
  t += 1; // controls
  const out = new Uint8Array(t);
  const dv = new DataView(out.buffer);
  let n = 0;
  out[n] = e.frames & 0xff;
  out[n + 1] = (e.frames >> 8) & 0xff;
  out[n + 2] = (e.frames >> 16) & 0xff;
  n += 3;
  dv.setFloat32(n, e.speedKmh, true);
  n += 4;
  out[n] =
    (e.hasStarted ? 1 : 0) |
    ((e.finishFrames != null ? 1 : 0) << 1) |
    ((e.hasCheckpointToRespawnAt ? 1 : 0) << 2) |
    ((e.wheelContact[0] != null ? 1 : 0) << 3) |
    ((e.wheelContact[1] != null ? 1 : 0) << 4) |
    ((e.wheelContact[2] != null ? 1 : 0) << 5) |
    ((e.wheelContact[3] != null ? 1 : 0) << 6);
  n += 1;
  if (e.finishFrames != null) {
    out[n] = e.finishFrames & 0xff;
    out[n + 1] = (e.finishFrames >> 8) & 0xff;
    out[n + 2] = (e.finishFrames >> 16) & 0xff;
    n += 3;
  }
  dv.setUint16(n, e.nextCheckpointIndex, true);
  n += 2;
  dv.setFloat32(n, e.position.x, true);
  dv.setFloat32(n + 4, e.position.y, true);
  dv.setFloat32(n + 8, e.position.z, true);
  n += 12;
  dv.setFloat32(n, e.quaternion.x, true);
  dv.setFloat32(n + 4, e.quaternion.y, true);
  dv.setFloat32(n + 8, e.quaternion.z, true);
  dv.setFloat32(n + 12, e.quaternion.w, true);
  n += 16;
  out[n] = e.collisionImpulses.length & 0xff;
  n += 1;
  for (const v of e.collisionImpulses) {
    dv.setFloat32(n, v, true);
    n += 4;
  }
  for (const c of e.wheelContact) {
    if (c == null) continue;
    dv.setFloat32(n, c.position.x, true);
    dv.setFloat32(n + 4, c.position.y, true);
    dv.setFloat32(n + 8, c.position.z, true);
    dv.setFloat32(n + 12, c.normal.x, true);
    dv.setFloat32(n + 16, c.normal.y, true);
    dv.setFloat32(n + 20, c.normal.z, true);
    n += 24;
  }
  for (const arr of [e.wheelSuspensionLength, e.wheelSuspensionVelocity, e.wheelDeltaRotation, e.wheelSkidInfo]) {
    for (let i = 0; i < 4; i++) {
      dv.setFloat32(n, arr[i] ?? 0, true);
      n += 4;
    }
  }
  dv.setFloat32(n, e.steering, true);
  n += 4;
  out[n] =
    (e.controls.up ? 1 : 0) |
    ((e.controls.right ? 1 : 0) << 1) |
    ((e.controls.down ? 1 : 0) << 2) |
    ((e.controls.left ? 1 : 0) << 3) |
    ((e.controls.reset ? 1 : 0) << 4) |
    ((e.brakeLightEnabled ? 1 : 0) << 5);
  n += 1;
  return out;
}

/** @returns {{numberOfBytes:number, carState:object}} */
export function decodeCarState(bytes) {
  const short = "CarState data is too short";
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  const need = (k) => {
    if (bytes.length < i + k) throw new Error(short);
  };
  need(3);
  const frames = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  i += 3;
  need(4);
  const speedKmh = dv.getFloat32(i, true);
  i += 4;
  need(1);
  const flags = bytes[i];
  const hasStarted = !!(flags & 1);
  const hasFinish = !!(flags & 2);
  const hasCheckpointToRespawnAt = !!(flags & 4);
  const contactFlags = [!!(flags & 8), !!(flags & 16), !!(flags & 32), !!(flags & 64)];
  i += 1;
  let finishFrames = null;
  if (hasFinish) {
    need(3);
    finishFrames = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
    i += 3;
  }
  need(2);
  const nextCheckpointIndex = dv.getUint16(i, true);
  i += 2;
  need(12);
  const position = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true) };
  i += 12;
  need(16);
  const quaternion = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true), w: dv.getFloat32(i + 12, true) };
  i += 16;
  need(1);
  const impulseCount = bytes[i];
  i += 1;
  if (impulseCount > 4) throw new Error("Number of collision impulses exceeds maximum allowed");
  const collisionImpulses = [];
  for (let k = 0; k < impulseCount; k++) {
    need(4);
    collisionImpulses.push(dv.getFloat32(i, true));
    i += 4;
  }
  const wheelContact = [null, null, null, null];
  for (let w = 0; w < 4; w++) {
    if (!contactFlags[w]) continue;
    need(24);
    const p = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true) };
    i += 12;
    const nrm = { x: dv.getFloat32(i, true), y: dv.getFloat32(i + 4, true), z: dv.getFloat32(i + 8, true) };
    i += 12;
    wheelContact[w] = { position: p, normal: nrm };
  }
  const readFour = () => {
    const arr = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      need(4);
      arr[k] = dv.getFloat32(i, true);
      i += 4;
    }
    return arr;
  };
  const wheelSuspensionLength = readFour();
  const wheelSuspensionVelocity = readFour();
  const wheelDeltaRotation = readFour();
  const wheelSkidInfo = readFour();
  need(4);
  const steering = dv.getFloat32(i, true);
  i += 4;
  need(1);
  const c = bytes[i];
  const controls = { up: !!(c & 1), right: !!(c & 2), down: !!(c & 4), left: !!(c & 8), reset: !!(c & 16) };
  const brakeLightEnabled = !!(c & 32);
  i += 1;
  return {
    numberOfBytes: i,
    carState: {
      frames,
      speedKmh,
      hasStarted,
      finishFrames,
      nextCheckpointIndex,
      hasCheckpointToRespawnAt,
      position,
      quaternion,
      collisionImpulses,
      wheelContact,
      wheelSuspensionLength,
      wheelSuspensionVelocity,
      wheelDeltaRotation,
      wheelSkidInfo,
      steering,
      brakeLightEnabled,
      controls,
    },
  };
}

/** Normalize the quaternion in place (the game does this for received states). */
export function normalizeQuaternion(q) {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) {
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
  } else {
    q.x /= len;
    q.y /= len;
    q.z /= len;
    q.w /= len;
  }
  return q;
}
