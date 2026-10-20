/**
 * Rating-based matchmaking queues.
 *
 * Every waiting player accepts opponents whose rating is within a window around
 * the group's mean rating. The window starts at `initialWindow` and grows with
 * waiting time so that lonely players eventually find a match.
 */
export class Matchmaker {
  /**
   * @param {object} queues queue configs keyed by id
   * @param {object} cfg matchmaking config
   */
  constructor(queues, cfg) {
    this.queues = queues;
    this.cfg = cfg;
    /** @type {Map<string, {playerId:string, rating:number, queueId:string, joinedAt:number}>} */
    this.waiting = new Map();
  }

  static requiredPlayers(queue) {
    return queue.players ?? queue.teams * queue.teamSize;
  }

  join(playerId, queueId, rating, now = Date.now()) {
    if (!this.queues[queueId]) throw new Error("Unknown queue");
    this.waiting.set(playerId, { playerId, rating, queueId, joinedAt: now });
  }

  leave(playerId) {
    return this.waiting.delete(playerId);
  }

  has(playerId) {
    return this.waiting.has(playerId);
  }

  queueOf(playerId) {
    return this.waiting.get(playerId)?.queueId ?? null;
  }

  status(queueId) {
    let n = 0;
    for (const e of this.waiting.values()) if (e.queueId === queueId) n++;
    return { queueId, waiting: n, required: Matchmaker.requiredPlayers(this.queues[queueId]) };
  }

  windowFor(entry, now) {
    const waited = Math.max(0, now - entry.joinedAt) / 1000;
    return Math.min(this.cfg.maxWindow, this.cfg.initialWindow + Math.floor(waited / 10) * this.cfg.windowGrowthPer10s);
  }

  /**
   * Try to form matches.
   * @returns {Array<{queueId:string, players:Array<{playerId:string, rating:number, team:number|null}>}>}
   */
  tick(now = Date.now()) {
    const formed = [];
    for (const [queueId, queue] of Object.entries(this.queues)) {
      const entries = [...this.waiting.values()].filter((e) => e.queueId === queueId).sort((a, b) => a.rating - b.rating);
      const required = Matchmaker.requiredPlayers(queue);
      const longestWait = entries.reduce((m, e) => Math.max(m, now - e.joinedAt), 0) / 1000;
      const minPlayers = queue.minPlayers && longestWait >= this.cfg.relaxAfterSeconds ? Math.max(2, queue.minPlayers) : required;

      let progress = true;
      while (progress && entries.length >= minPlayers) {
        progress = false;
        for (let size = Math.min(required, entries.length); size >= minPlayers; size--) {
          const group = this.findGroup(entries, size, now);
          if (group) {
            for (const g of group) {
              this.waiting.delete(g.playerId);
              entries.splice(entries.indexOf(g), 1);
            }
            formed.push({ queueId, players: this.assignTeams(queue, group) });
            progress = true;
            break;
          }
        }
      }
    }
    return formed;
  }

  /** Find `size` consecutive (by rating) entries that all accept the group's mean rating. */
  findGroup(sortedEntries, size, now) {
    let best = null;
    let bestSpread = Infinity;
    for (let i = 0; i + size <= sortedEntries.length; i++) {
      const group = sortedEntries.slice(i, i + size);
      const mean = group.reduce((a, e) => a + e.rating, 0) / size;
      const ok = group.every((e) => Math.abs(e.rating - mean) <= this.windowFor(e, now));
      if (!ok) continue;
      const spread = group[size - 1].rating - group[0].rating;
      if (spread < bestSpread) {
        bestSpread = spread;
        best = group;
      }
    }
    return best;
  }

  /** Snake draft on rating for team queues; null team for FFA. */
  assignTeams(queue, group) {
    if (!queue.teams) {
      return group.map((e) => ({ playerId: e.playerId, rating: e.rating, team: null }));
    }
    const sorted = group.slice().sort((a, b) => b.rating - a.rating);
    const pattern = [0, 1, 1, 0];
    return sorted.map((e, i) => ({ playerId: e.playerId, rating: e.rating, team: pattern[i % pattern.length] }));
  }
}
