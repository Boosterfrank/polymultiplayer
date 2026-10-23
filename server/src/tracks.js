/** Track pool handling. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRACK_CATEGORIES = ["official", "community", "custom"];

function guessCategory(t) {
  if (TRACK_CATEGORIES.includes(t.category)) return t.category;
  if (typeof t.trackUrl === "string" && /\/community\//.test(t.trackUrl)) return "community";
  if (typeof t.trackUrl === "string" && /\/official\//.test(t.trackUrl)) return "official";
  return t.trackCode ? "custom" : "official";
}

export function buildPool(tracks, defaults = {}) {
  return (tracks ?? [])
    .filter((t) => t && t.id && (t.trackUrl || t.trackCode))
    .map((t) => ({
      id: t.id,
      name: t.name ?? t.id.slice(0, 8),
      author: t.author ?? null,
      trackUrl: t.trackUrl ?? null,
      trackCode: t.trackCode ?? null,
      category: guessCategory(t),
      tier: t.tier ?? 1,
      roundSeconds: t.roundSeconds ?? defaults.roundSeconds ?? 90,
      enabled: t.enabled !== false,
    }));
}

/** The community tracks shipped with PolyTrack 0.6.3 (server/tracks.community.json). */
export function loadCommunityTracks(file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tracks.community.json")) {
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(list) ? list.map((t) => ({ ...t, category: "community" })) : [];
  } catch {
    return [];
  }
}

/**
 * Pick a random enabled track with tier <= maxTier, avoiding recently used ids when possible.
 * @param {ReturnType<typeof buildPool>} pool
 */
export function pickTrack(pool, maxTier, recentIds = [], rng = Math.random) {
  const enabled = pool.filter((t) => t.enabled !== false);
  if (enabled.length === 0) return null;
  let candidates = enabled.filter((t) => t.tier <= maxTier);
  if (candidates.length === 0) candidates = enabled;
  const fresh = candidates.filter((t) => !recentIds.includes(t.id));
  const list = fresh.length > 0 ? fresh : candidates;
  return list[Math.floor(rng() * list.length)];
}

/** What the client needs to load a track. */
export function publicTrack(track) {
  if (!track) return null;
  return {
    id: track.id,
    name: track.name,
    author: track.author,
    category: track.category ?? "custom",
    trackUrl: track.trackUrl,
    trackCode: track.trackCode,
    roundSeconds: track.roundSeconds,
  };
}
