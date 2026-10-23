/**
 * World records from PolyTrack's leaderboard (the same request the game makes), cached per track.
 * PolyTrack's backend only answers known origins, so the request carries the Origin header of the
 * PolyModLoader desktop app – the same trick as the Kodub proxy. Failures are remembered briefly
 * ("unavailable") so a dead backend does not delay every round.
 */
export const LEADERBOARD_URL = "https://vps.kodub.com/v6/leaderboard";

export function createWorldRecords({ enabled = true, cacheSeconds = 900, timeoutMs = 8000, origin = "https://app-polytrack-desktop.polymodloader.com", fetchImpl = globalThis.fetch, now = () => Date.now(), log = console } = {}) {
  /** @type {Map<string, {record: object, until: number, pending: Promise|null}>} */
  const cache = new Map();

  function parse(json) {
    const entry = json?.entries?.[0];
    if (!entry) return { status: "missing" };
    const frames = Number(entry.frames);
    if (!Number.isSafeInteger(frames) || frames <= 0) return { status: "missing" };
    return {
      status: "ready",
      frames,
      nickname: String(entry.nickname ?? "?").slice(0, 64),
      countryCode: typeof entry.countryCode === "string" && /^[a-z]{2}$/i.test(entry.countryCode) ? entry.countryCode.toLowerCase() : null,
    };
  }

  async function request(trackId, verified) {
    const url = `${LEADERBOARD_URL}?version=0.6.3&trackId=${encodeURIComponent(trackId)}&skip=0&amount=1&onlyVerified=${verified ? "true" : "false"}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers: { origin, referer: origin + "/", accept: "application/json" }, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parse(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  /** Cached record or null while unknown. */
  function peek(trackId) {
    const c = cache.get(trackId);
    return c && c.until > now() ? c.record : null;
  }

  /**
   * Resolve the record for a track; `onReady` runs once (asynchronously) when a fresh answer arrives.
   * @returns {object|null} the cached record when one is known right away
   */
  function lookup(trackId, { verified = true, onReady } = {}) {
    if (!enabled || typeof fetchImpl !== "function") return { status: "unavailable" };
    const cached = peek(trackId);
    if (cached) return cached;
    let c = cache.get(trackId);
    if (!c?.pending) {
      c = { record: c?.record ?? null, until: 0, pending: null };
      cache.set(trackId, c);
      c.pending = request(trackId, verified)
        .catch((err) => {
          log.warn?.(`[cup] world record lookup for ${trackId.slice(0, 8)} failed: ${err.message}`);
          return { status: "unavailable" };
        })
        .then((record) => {
          c.record = record;
          c.until = now() + (record.status === "unavailable" ? Math.min(cacheSeconds, 60) : cacheSeconds) * 1000;
          c.pending = null;
          return record;
        });
    }
    if (onReady) c.pending.then((record) => onReady(record)).catch(() => {});
    return null;
  }

  return { lookup, peek, cache };
}
