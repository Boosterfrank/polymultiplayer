/**
 * Pure match rules: ranking a round, awarding points, deciding when a match is over.
 * A "slot" is the small numeric per-match player id used by the game.
 */

/**
 * Sort round results. Finished players first (fastest first), DNF (frames == null) last.
 * Ties share a position; DNF players get position null.
 * @param {Array<{slot:number, frames:number|null}>} entries
 * @returns {Array<{slot:number, frames:number|null, position:number|null}>}
 */
export function rankResults(entries) {
  const finished = entries.filter((e) => e.frames != null).sort((a, b) => a.frames - b.frames || a.slot - b.slot);
  const dnf = entries.filter((e) => e.frames == null).sort((a, b) => a.slot - b.slot);
  const ranked = [];
  let position = 0;
  for (let i = 0; i < finished.length; i++) {
    if (i === 0 || finished[i].frames !== finished[i - 1].frames) position = i + 1;
    ranked.push({ slot: finished[i].slot, frames: finished[i].frames, position });
  }
  for (const e of dnf) ranked.push({ slot: e.slot, frames: null, position: null });
  return ranked;
}

export function pointsForPosition(position, table) {
  if (position == null) return 0;
  return table[position - 1] ?? 0;
}

/**
 * Score one round.
 * @param {object} args
 * @param {"duel"|"teams"|"points"} args.scoring
 * @param {number[]} [args.pointsTable]
 * @param {Array<{slot:number, frames:number|null, team:number|null}>} args.entries active players only
 * @returns {{ranked:Array, points:Record<number,number>, teamPoints:number[]|null, roundWinner:{type:"team",team:number}|{type:"player",slot:number}|null}}
 */
export function scoreRound({ scoring, pointsTable = [], entries }) {
  const ranked = rankResults(entries);
  const teamOf = new Map(entries.map((e) => [e.slot, e.team]));
  const points = {};
  for (const r of ranked) points[r.slot] = 0;

  if (scoring === "duel") {
    const best = ranked[0];
    let roundWinner = null;
    if (best && best.frames != null) {
      const tied = ranked.filter((r) => r.position === 1);
      if (tied.length === 1) {
        points[best.slot] = 1;
        roundWinner = { type: "team", team: teamOf.get(best.slot) ?? 0 };
      }
    }
    return { ranked, points, teamPoints: null, roundWinner };
  }

  if (scoring === "teams") {
    const perTeam = [[], []];
    for (const r of ranked) {
      const pts = pointsForPosition(r.position, pointsTable);
      points[r.slot] = pts;
      const t = teamOf.get(r.slot);
      if (t === 0 || t === 1) perTeam[t].push({ pts, frames: r.frames });
    }
    // Only the best k players of each team count, k = size of the smaller team (TM rule for leavers).
    const k = Math.max(1, Math.min(perTeam[0].length, perTeam[1].length));
    const teamPoints = perTeam.map((arr) =>
      arr
        .slice()
        .sort((a, b) => b.pts - a.pts)
        .slice(0, k)
        .reduce((a, e) => a + e.pts, 0),
    );
    let roundWinner = null;
    if (teamPoints[0] !== teamPoints[1]) {
      roundWinner = { type: "team", team: teamPoints[0] > teamPoints[1] ? 0 : 1 };
    } else {
      const bestTime = perTeam.map((arr) => arr.reduce((m, e) => (e.frames != null && (m == null || e.frames < m) ? e.frames : m), null));
      if (bestTime[0] != null && (bestTime[1] == null || bestTime[0] < bestTime[1])) roundWinner = { type: "team", team: 0 };
      else if (bestTime[1] != null && (bestTime[0] == null || bestTime[1] < bestTime[0])) roundWinner = { type: "team", team: 1 };
    }
    return { ranked, points, teamPoints, roundWinner };
  }

  // "points" (free for all)
  for (const r of ranked) points[r.slot] = pointsForPosition(r.position, pointsTable);
  const winners = ranked.filter((r) => r.position === 1);
  const roundWinner = winners.length === 1 ? { type: "player", slot: winners[0].slot } : null;
  return { ranked, points, teamPoints: null, roundWinner };
}

/**
 * Decide whether the match is over.
 * @param {object} args
 * @param {"duel"|"teams"|"points"} args.scoring
 * @param {number} args.roundsPlayed
 * @param {number} [args.roundsToWin]
 * @param {number} args.maxRounds
 * @param {number[]} args.roundWins per team (duel/teams)
 * @param {Record<number,number>} args.totalPoints per slot
 * @param {Map<number,number|null>} args.teamOf slot -> team
 * @param {Set<number>} args.activeSlots players still in the match
 * @returns {{finished:boolean, winner:{type:"team",team:number}|{type:"player",slot:number}|null, reason:string|null}}
 */
export function evaluateMatch({ scoring, roundsPlayed, roundsToWin, maxRounds, roundWins, totalPoints, teamOf, activeSlots }) {
  if (scoring === "duel" || scoring === "teams") {
    const activeTeams = new Set([...activeSlots].map((s) => teamOf.get(s)));
    if (activeTeams.size <= 1) {
      const team = activeTeams.size === 1 ? [...activeTeams][0] : null;
      return { finished: true, winner: team == null ? null : { type: "team", team }, reason: "forfeit" };
    }
    for (const t of [0, 1]) {
      if (roundWins[t] >= roundsToWin) return { finished: true, winner: { type: "team", team: t }, reason: "rounds" };
    }
    if (roundsPlayed >= maxRounds) {
      if (roundWins[0] !== roundWins[1]) {
        return { finished: true, winner: { type: "team", team: roundWins[0] > roundWins[1] ? 0 : 1 }, reason: "max_rounds" };
      }
      const teamPts = [0, 0];
      for (const [slot, pts] of Object.entries(totalPoints)) {
        const t = teamOf.get(Number(slot));
        if (t === 0 || t === 1) teamPts[t] += pts;
      }
      if (teamPts[0] !== teamPts[1]) {
        return { finished: true, winner: { type: "team", team: teamPts[0] > teamPts[1] ? 0 : 1 }, reason: "max_rounds" };
      }
      return { finished: true, winner: null, reason: "draw" };
    }
    return { finished: false, winner: null, reason: null };
  }

  // points / ffa
  if (activeSlots.size <= 1) {
    const slot = activeSlots.size === 1 ? [...activeSlots][0] : null;
    return { finished: true, winner: slot == null ? null : { type: "player", slot }, reason: "forfeit" };
  }
  if (roundsPlayed >= maxRounds) {
    let best = -Infinity;
    let winners = [];
    for (const slot of activeSlots) {
      const pts = totalPoints[slot] ?? 0;
      if (pts > best) {
        best = pts;
        winners = [slot];
      } else if (pts === best) winners.push(slot);
    }
    return {
      finished: true,
      winner: winners.length === 1 ? { type: "player", slot: winners[0] } : null,
      reason: winners.length === 1 ? "max_rounds" : "draw",
    };
  }
  return { finished: false, winner: null, reason: null };
}

/**
 * Final placement (1-based, ties share) of every slot for FFA rating purposes.
 * @param {Record<number,number>} totalPoints
 * @param {number[]} slots
 */
export function placementsByPoints(totalPoints, slots) {
  const sorted = slots.slice().sort((a, b) => (totalPoints[b] ?? 0) - (totalPoints[a] ?? 0));
  const place = new Map();
  let pos = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || (totalPoints[sorted[i]] ?? 0) !== (totalPoints[sorted[i - 1]] ?? 0)) pos = i + 1;
    place.set(sorted[i], pos);
  }
  return place;
}
