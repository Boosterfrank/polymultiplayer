/** Track pool handling. */

export function buildPool(tracks, defaults = {}) {
  return (tracks ?? [])
    .filter((t) => t && t.id && (t.trackUrl || t.trackCode))
    .map((t) => ({
      id: t.id,
      name: t.name ?? t.id.slice(0, 8),
      author: t.author ?? null,
      trackUrl: t.trackUrl ?? null,
      trackCode: t.trackCode ?? null,
      tier: t.tier ?? 1,
      roundSeconds: t.roundSeconds ?? defaults.roundSeconds ?? 90,
      enabled: t.enabled !== false,
    }));
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
  return {
    id: track.id,
    name: track.name,
    author: track.author,
    trackUrl: track.trackUrl,
    trackCode: track.trackCode,
    roundSeconds: track.roundSeconds,
  };
}
