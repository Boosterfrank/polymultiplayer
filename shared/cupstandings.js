// Ranking helpers for the always-on cup, shared by the server (scoring, live movement) and the
// mod's HUD (ROUND RANKING / CUP STANDINGS rows). Pure functions over the cup's public state.

/**
 * Order of the racers during a live round: finishers by time, then racers still driving by
 * checkpoint progress (further ahead first, earlier at the same gate first), retired racers last.
 * @param {object} live `state.live` ({racers, finishes, dnfs, splits})
 * @param {number[]} slots slots to order (racers of the round)
 * @returns {number[]}
 */
export function liveOrder(live, slots) {
  const finishes = live?.finishes ?? {};
  const splits = live?.splits ?? {};
  const dnfs = new Set(live?.dnfs ?? []);
  const finished = slots.filter((s) => finishes[s] != null).sort((a, b) => finishes[a] - finishes[b] || a - b);
  const pending = slots
    .filter((s) => finishes[s] == null)
    .sort((a, b) => Number(dnfs.has(a)) - Number(dnfs.has(b)) || (splits[b]?.index ?? -1) - (splits[a]?.index ?? -1) || (splits[a]?.frames ?? Infinity) - (splits[b]?.frames ?? Infinity) || a - b);
  return [...finished, ...pending];
}

/** 1-based finishing places, exact ties share a place. @param {Record<number, number>} finishes */
export function finishPlaces(finishes) {
  const order = Object.keys(finishes)
    .map(Number)
    .sort((a, b) => finishes[a] - finishes[b] || a - b);
  const places = {};
  for (let i = 0; i < order.length; i++) {
    const slot = order[i];
    places[slot] = i > 0 && finishes[slot] === finishes[order[i - 1]] ? places[order[i - 1]] : i + 1;
  }
  return places;
}

/** Cup standings order: points, then the order players joined (slot). Winners first once the cup is over. */
export function cupOrder(state) {
  const players = state.players ?? [];
  const winner = state.winner?.slot ?? null;
  return players
    .map((p) => p.slot)
    .sort((a, b) => {
      if (a === winner) return -1;
      if (b === winner) return 1;
      const pa = players.find((p) => p.slot === a)?.points ?? 0;
      const pb = players.find((p) => p.slot === b)?.points ?? 0;
      return pb - pa || a - b;
    });
}

/**
 * Rows for the scoreboard. During a live round the rows follow the race, otherwise the cup standings
 * (with the points gained in the last round).
 * @param {object} state the cup's public state
 * @returns {Array<{slot:number, id:string, nickname:string, position:number, score:number, gain:number, provisional:boolean, movement:number, frames:number|null, dnf:boolean, checkpoint:number|null, splitFrames:number|null, delta:number|null, winner:boolean, racing:boolean, pending:boolean, connected:boolean}>}
 */
export function standings(state) {
  const players = state.players ?? [];
  const live = state.phase === "racing" && state.live ? state.live : null;
  const last = !live && state.lastRound && state.phase !== "complete" ? state.lastRound : null;
  const rules = state.rules ?? {};
  const points = rules.points ?? [];
  const racers = live ? live.racers ?? [] : [];
  const racingSlots = new Set(racers);
  // Racers of the live round first (race order), then everyone waiting for the next round.
  const order = live ? [...liveOrder(live, racers), ...cupOrder(state).filter((s) => !racingSlots.has(s))] : cupOrder(state);
  const finishes = live ? live.finishes ?? {} : last ? last.finishes ?? {} : {};
  const places = finishPlaces(finishes);
  const best = Object.values(finishes).length ? Math.min(...Object.values(finishes)) : null;
  const splits = live ? live.splits ?? {} : {};
  const dnfs = new Set(live ? live.dnfs ?? [] : last ? last.dnfs ?? [] : []);
  return order
    .map((slot) => players.find((p) => p.slot === slot))
    .filter(Boolean)
    .map((p, i) => {
      const slot = p.slot;
      const place = places[slot] ?? null;
      const gain = live ? (place ? points[place - 1] ?? 0 : 0) : last ? last.points?.[slot] ?? 0 : 0;
      const split = splits[slot];
      return {
        slot,
        id: p.id,
        nickname: p.nickname,
        position: live && place ? place : i + 1,
        score: p.points ?? 0,
        gain,
        provisional: !!live,
        movement: live ? live.movement?.[slot] ?? 0 : last ? last.movement?.[slot] ?? 0 : 0,
        frames: finishes[slot] ?? null,
        dnf: dnfs.has(slot),
        checkpoint: split ? split.index : null,
        splitFrames: split ? split.frames : null,
        delta: finishes[slot] != null && best != null ? finishes[slot] - best : split && split.bestFrames != null ? split.frames - split.bestFrames : null,
        winner: state.winner?.slot === slot,
        racing: racingSlots.has(slot),
        pending: !!p.pending,
        connected: p.connected !== false,
      };
    });
}

/** Points-based cup places (1-based, ties share). */
export function cupPlaces(players) {
  const sorted = [...players].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const places = new Map();
  let place = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || (sorted[i].points ?? 0) !== (sorted[i - 1].points ?? 0)) place = i + 1;
    places.set(sorted[i].slot, place);
  }
  return places;
}
