import { MSG } from "../../shared/protocol.js";
import { SplitsWidget } from "./ui/splits.js";
import { log } from "./util.js";

/**
 * Checkpoint splits like Trackmania's, for every run (solo, ranked, cup): the local car's checkpoint
 * callback feeds the widget with the speed and the time; the comparison comes from the cup server
 * during a live round (rank at the checkpoint and gap to the fastest racer there, `cup_split`) and
 * from the fastest ghost otherwise (the game's own PB ghost).
 */
export class SplitsController {
  /**
   * @param {object} opts
   * @param {object|null} opts.native connectGame() result
   * @param {object} opts.client ranked client (for cup_split)
   * @param {() => boolean} opts.enabled
   * @param {(game, car, frames) => {inCup: boolean, frames: number, sessionId: number|null}} opts.roundTime cup round time of a car time
   */
  constructor({ native, client, enabled = () => true, roundTime = null }) {
    this.native = native;
    this.client = client;
    this.enabled = enabled;
    this.roundTime = roundTime;
    this.widget = new SplitsWidget();
    this.hooked = new WeakSet();
    this.pending = null; // {sessionId, index} waiting for the cup's answer
    this._unsubs = [];
    if (native?.onFrame) this._unsubs.push(native.onFrame((game) => this.observe(game)));
    this._unsubs.push(client.on(MSG.CUP_SPLIT, (msg) => this.onCupSplit(msg)));
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs = [];
    this.widget.dispose();
  }

  /** Every frame of any in-game state: hook the current local car once. */
  observe(game) {
    const car = this.native.read(game)?.car;
    if (!car || this.hooked.has(car)) return;
    this.hooked.add(car);
    car.addCheckpointCallback(() => {
      try {
        if (this.native.read(game)?.car !== car) return;
        const index = car.getNextCheckpointIndex() - 1;
        if (index < 0) return;
        this.onCheckpoint({ game, car, index, frames: car.getTime().numberOfFrames, speed: car.getSpeedKmh?.() });
      } catch (err) {
        log.warn("split failed", err);
      }
    });
  }

  /**
   * A checkpoint of the local car. `frames` is the car's clock; in a cup round the round time is shown.
   * @param {{game?: object, car?: object, index: number, frames: number, speed?: number}} info
   */
  onCheckpoint(info) {
    if (!this.enabled()) return;
    const round = this.roundTime ? this.roundTime(info.game, info.car, info.frames) : null;
    if (round?.inCup) {
      this.pending = { sessionId: round.sessionId, index: info.index };
      this.widget.show({ frames: round.frames, speed: info.speed, speedDelta: null, position: null, delta: null, pending: true });
      return;
    }
    const ghost = this.ghostSplit(info.game, info.index);
    this.pending = null;
    this.widget.show({
      frames: info.frames,
      speed: info.speed,
      speedDelta: ghost && Number.isFinite(info.speed) && Number.isFinite(ghost.speed) ? info.speed - ghost.speed : null,
      position: null,
      delta: ghost ? info.frames - ghost.frames : null,
    });
  }

  /** The fastest ghost's time and speed at a checkpoint, when the game has one. */
  ghostSplit(game, index) {
    if (!game || !this.native?.fastestGhost) return null;
    try {
      const ghost = this.native.fastestGhost(game);
      const cp = ghost?.checkpoints?.[index];
      const frames = cp?.time?.numberOfFrames;
      if (!Number.isInteger(frames)) return null;
      return { frames, speed: Number.isFinite(cp.speedKmh) ? cp.speedKmh : null };
    } catch {
      return null;
    }
  }

  /** The cup's answer: rank at the checkpoint and the gap to the fastest racer there. */
  onCupSplit(msg) {
    const p = this.pending;
    if (!p || msg.sessionId !== p.sessionId || msg.index !== p.index) return;
    this.pending = null;
    if (!this.widget.current) return;
    this.widget.update({ position: msg.position ?? null, delta: Number.isFinite(msg.delta) ? msg.delta : null, pending: false });
  }
}
