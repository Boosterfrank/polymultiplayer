import { createHash } from "node:crypto";
import { describeRating } from "./rating.js";

const NICK_MAX = 24;

export function sanitizeNickname(nick) {
  if (typeof nick !== "string") return "Anonymous";
  const cleaned = nick.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NICK_MAX);
  return cleaned.length > 0 ? cleaned : "Anonymous";
}

export function sanitizeCountryCode(code) {
  return typeof code === "string" && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}

export function sanitizeCarStyle(style) {
  // The game serializes the car style as a short base64 string; keep it opaque but bounded.
  return typeof style === "string" && style.length > 0 && style.length <= 64 && /^[A-Za-z0-9+/=_-]+$/.test(style) ? style : null;
}

/** Players and their per-queue ratings, persisted through a JsonStore. */
export class PlayerRegistry {
  constructor(store, ratingCfg) {
    this.store = store;
    this.ratingCfg = ratingCfg;
  }

  static idFromSecret(secret) {
    return createHash("sha256").update(String(secret)).digest("hex");
  }

  get players() {
    return this.store.data.players;
  }

  getOrCreate(id, profile = {}) {
    let p = this.players[id];
    const now = Date.now();
    if (!p) {
      p = {
        id,
        nickname: sanitizeNickname(profile.nickname),
        countryCode: sanitizeCountryCode(profile.countryCode),
        carStyle: sanitizeCarStyle(profile.carStyle),
        createdAt: now,
        lastSeen: now,
        ratings: {},
      };
      this.players[id] = p;
    } else {
      if (profile.nickname != null) p.nickname = sanitizeNickname(profile.nickname);
      if (profile.countryCode !== undefined) p.countryCode = sanitizeCountryCode(profile.countryCode);
      if (profile.carStyle != null) p.carStyle = sanitizeCarStyle(profile.carStyle);
      p.lastSeen = now;
    }
    this.store.markDirty();
    return p;
  }

  get(id) {
    return this.players[id] ?? null;
  }

  ratingEntry(id, queueId) {
    const p = this.players[id];
    if (!p) throw new Error("Unknown player");
    if (!p.ratings[queueId]) {
      p.ratings[queueId] = { rating: this.ratingCfg.initial, matches: 0, wins: 0, losses: 0, draws: 0, peak: this.ratingCfg.initial };
    }
    return p.ratings[queueId];
  }

  /**
   * @param {"win"|"loss"|"draw"} result
   */
  applyResult(id, queueId, delta, result) {
    const e = this.ratingEntry(id, queueId);
    e.rating = Math.max(0, Math.round(e.rating + delta));
    e.matches += 1;
    if (result === "win") e.wins += 1;
    else if (result === "loss") e.losses += 1;
    else e.draws += 1;
    e.peak = Math.max(e.peak ?? e.rating, e.rating);
    this.store.markDirty();
    return e;
  }

  publicProfile(id, queueIds) {
    const p = this.players[id];
    if (!p) return null;
    const ratings = {};
    for (const q of queueIds) ratings[q] = describeRating(p.ratings[q], this.ratingCfg);
    return { id, nickname: p.nickname, countryCode: p.countryCode, carStyle: p.carStyle, ratings };
  }

  leaderboard(queueId, limit = 50) {
    const rows = [];
    for (const p of Object.values(this.players)) {
      const e = p.ratings?.[queueId];
      if (!e || e.matches < this.ratingCfg.placementMatches) continue;
      rows.push({ id: p.id, nickname: p.nickname, countryCode: p.countryCode, ...describeRating(e, this.ratingCfg) });
    }
    rows.sort((a, b) => b.rating - a.rating || b.matches - a.matches);
    return rows.slice(0, limit).map((r, i) => ({ position: i + 1, ...r }));
  }

  /** Cup participation; `won` marks the winner of a completed cup. */
  applyCupResult(id, { won, points }) {
    const p = this.players[id];
    if (!p) return null;
    p.cup = p.cup ?? { cups: 0, wins: 0, points: 0 };
    p.cup.cups += 1;
    if (won) p.cup.wins += 1;
    p.cup.points += Math.max(0, points | 0);
    this.store.markDirty();
    return p.cup;
  }

  cupLeaderboard(limit = 50) {
    const rows = [];
    for (const p of Object.values(this.players)) {
      if (!p.cup || !p.cup.cups) continue;
      rows.push({ id: p.id, nickname: p.nickname, countryCode: p.countryCode, cups: p.cup.cups, wins: p.cup.wins, points: p.cup.points });
    }
    rows.sort((a, b) => b.wins - a.wins || b.points - a.points || b.cups - a.cups);
    return rows.slice(0, limit).map((r, i) => ({ position: i + 1, ...r }));
  }

  recordCup(summary, keep = 200) {
    const data = this.store.data;
    data.cups = data.cups ?? [];
    data.cups.push(summary);
    if (data.cups.length > keep) data.cups.splice(0, data.cups.length - keep);
    this.store.markDirty();
  }

  recordMatch(summary, keep = 500) {
    const list = this.store.data.matches;
    list.push(summary);
    if (list.length > keep) list.splice(0, list.length - keep);
    this.store.markDirty();
  }

  nextMatchSeq() {
    const meta = this.store.data.meta;
    meta.matchCounter = (meta.matchCounter ?? 0) + 1;
    this.store.markDirty();
    return meta.matchCounter;
  }
}
