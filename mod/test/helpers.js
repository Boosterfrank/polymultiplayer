const f = Math.fround;

/** A fully populated car state (float32-rounded so round trips compare equal). */
export function sampleState(overrides = {}) {
  return {
    frames: 12345,
    speedKmh: f(123.4),
    hasStarted: true,
    finishFrames: 11000,
    nextCheckpointIndex: 3,
    hasCheckpointToRespawnAt: true,
    position: { x: f(1.5), y: f(-2.25), z: f(300.125) },
    quaternion: { x: 0, y: f(0.7071067811865476), z: 0, w: f(0.7071067811865476) },
    collisionImpulses: [f(0.5), f(2)],
    wheelContact: [{ position: { x: f(1), y: f(2), z: f(3) }, normal: { x: 0, y: 1, z: 0 } }, null, null, { position: { x: f(-1), y: 0, z: f(0.5) }, normal: { x: 0, y: 1, z: 0 } }],
    wheelSuspensionLength: [f(0.07), f(0.07), f(0.08), f(0.08)],
    wheelSuspensionVelocity: [0, f(0.1), f(-0.1), 0],
    wheelDeltaRotation: [f(0.01), f(0.02), f(0.03), f(0.04)],
    wheelSkidInfo: [0, 0, f(0.9), 1],
    steering: f(-0.3),
    brakeLightEnabled: true,
    controls: { up: true, right: false, down: false, left: true, reset: false },
    ...overrides,
  };
}
