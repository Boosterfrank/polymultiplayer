import { deepMerge, DEFAULT_CONFIG } from "../src/config.js";

/** Deterministic clock for the match state machine. */
export class FakeClock {
  constructor(start = 1_000_000) {
    this.t = start;
    this.timers = [];
    this.seq = 0;
  }
  now() {
    return this.t;
  }
  setTimeout(fn, ms) {
    const timer = { id: ++this.seq, at: this.t + Math.max(0, ms), fn };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer) {
    this.timers = this.timers.filter((t) => t !== timer);
  }
  /** Advance time, firing due timers in order. */
  advance(ms) {
    const target = this.t + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id);
      if (due.length === 0) break;
      const next = due[0];
      this.timers = this.timers.filter((t) => t !== next);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = target;
  }
}

/** Collects everything a match sends. */
export class FakeIO {
  constructor() {
    this.messages = []; // {to, msg}
    this.binary = []; // {to, bytes}
    this.finished = null;
  }
  send(to, msg) {
    this.messages.push({ to, msg });
  }
  sendBinary(to, bytes) {
    this.binary.push({ to, bytes });
  }
  getPing() {
    return 42;
  }
  onFinished(match, summary) {
    this.finished = summary;
  }
  of(to, type) {
    return this.messages.filter((m) => m.to === to && (!type || m.msg.type === type)).map((m) => m.msg);
  }
  last(to, type) {
    const list = this.of(to, type);
    return list[list.length - 1];
  }
}

export function testConfig(overrides = {}) {
  return deepMerge(
    deepMerge(DEFAULT_CONFIG, {
      rounds: { countdownSeconds: 3, finishGraceSeconds: 10, resultsSeconds: 5, readyTimeoutSeconds: 20, disconnectGraceSeconds: 15, lateRecordGraceMs: 1000 },
      tracks: [
        { id: "a".repeat(64), name: "Test Track", trackUrl: "tracks/official/summer1.track", tier: 1, roundSeconds: 60 },
        { id: "b".repeat(64), name: "Second Track", trackUrl: "tracks/official/summer2.track", tier: 1, roundSeconds: 60 },
      ],
    }),
    overrides,
  );
}

export function makePlayers(n, { teams = true } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `p${i + 1}`,
      nickname: `Player ${i + 1}`,
      countryCode: null,
      carStyle: null,
      team: teams ? i % 2 : null,
      rating: 1000,
      matches: 10,
    });
  }
  return out;
}
