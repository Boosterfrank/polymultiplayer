/** Elo-style rating with Trackmania-like divisions. All functions are pure. */

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function kFactor(matchesPlayed, cfg) {
  return matchesPlayed < cfg.placementMatches ? cfg.kPlacement : cfg.kNormal;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Compute rating changes for a finished match.
 *
 * @param {object} args
 * @param {"duel"|"teams"|"ffa"} args.mode
 * @param {Array<{id:string, rating:number, matches:number, team:number|null, points:number, place:number|null}>} args.participants
 *   `place` is the final placement (1 = best, ties share a place) used for ffa.
 * @param {number|null} [args.winnerTeam] for duel/teams: 0 or 1, null for a draw
 * @param {object} args.cfg rating config
 * @returns {Map<string, {before:number, after:number, delta:number}>}
 */
export function computeRatingChanges({ mode, participants, winnerTeam = null, cfg }) {
  const out = new Map();
  if (participants.length < 2) {
    for (const p of participants) out.set(p.id, { before: p.rating, after: p.rating, delta: 0 });
    return out;
  }
  if (mode === "ffa") {
    const n = participants.length;
    for (const p of participants) {
      let sum = 0;
      for (const q of participants) {
        if (q === p) continue;
        const s = p.place === q.place ? 0.5 : p.place < q.place ? 1 : 0;
        sum += s - expectedScore(p.rating, q.rating);
      }
      const delta = Math.round((kFactor(p.matches, cfg) / (n - 1)) * sum);
      out.set(p.id, { before: p.rating, after: p.rating + delta, delta });
    }
    return out;
  }

  // duel / teams: team mean ratings
  const teams = [0, 1].map((t) => participants.filter((p) => p.team === t));
  const mean = (arr) => (arr.length ? arr.reduce((a, p) => a + p.rating, 0) / arr.length : 0);
  const teamRating = teams.map(mean);
  const teamPoints = teams.map((arr) => (arr.length ? arr.reduce((a, p) => a + (p.points ?? 0), 0) / arr.length : 0));

  for (const p of participants) {
    const t = p.team;
    const opp = 1 - t;
    const expected = expectedScore(teamRating[t], teamRating[opp]);
    const score = winnerTeam == null ? 0.5 : winnerTeam === t ? 1 : 0;
    let delta = kFactor(p.matches, cfg) * (score - expected);
    if (mode === "teams" && teams[t].length > 1) {
      // Reward individual contribution: +/- up to 50 % depending on points vs team average.
      const avg = teamPoints[t];
      const perf = avg > 0 ? clamp((p.points - avg) / avg, -0.5, 0.5) : 0;
      delta = delta > 0 ? delta * (1 + 0.5 * perf) : delta * (1 - 0.5 * perf);
    }
    delta = Math.round(delta);
    out.set(p.id, { before: p.rating, after: p.rating + delta, delta });
  }
  return out;
}

/**
 * @returns {{name:string, tier:number, index:number, placement:boolean, label:string}}
 */
export function divisionFor(rating, matches, cfg) {
  const divisions = cfg.divisions;
  let idx = 0;
  for (let i = 0; i < divisions.length; i++) {
    if (rating >= divisions[i].min) idx = i;
  }
  const d = divisions[idx];
  const placement = matches < cfg.placementMatches;
  return {
    name: d.name,
    tier: d.tier,
    index: idx,
    placement,
    label: placement ? `Unranked (${matches}/${cfg.placementMatches})` : d.name,
  };
}

/** Public rating summary for one queue. */
export function describeRating(entry, cfg) {
  const rating = entry?.rating ?? cfg.initial;
  const matches = entry?.matches ?? 0;
  const div = divisionFor(rating, matches, cfg);
  return {
    rating,
    matches,
    wins: entry?.wins ?? 0,
    losses: entry?.losses ?? 0,
    draws: entry?.draws ?? 0,
    peak: entry?.peak ?? rating,
    division: div.name,
    divisionTier: div.tier,
    divisionIndex: div.index,
    placement: div.placement,
    label: div.label,
  };
}
