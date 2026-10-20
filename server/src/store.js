import fs from "node:fs";
import path from "node:path";

/**
 * Tiny JSON persistence: everything lives in one object, writes are debounced
 * and atomic (write to a temp file, then rename).
 */
export class JsonStore {
  /**
   * @param {string|null} filePath null = in-memory only (tests)
   */
  constructor(filePath, { saveDelayMs = 1000, log = console } = {}) {
    this.filePath = filePath;
    this.saveDelayMs = saveDelayMs;
    this.log = log;
    this.data = { players: {}, matches: [], meta: { matchCounter: 0 } };
    this._timer = null;
    this._dirty = false;
  }

  load() {
    if (!this.filePath) return this.data;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        this.data = {
          players: parsed.players ?? {},
          matches: parsed.matches ?? [],
          meta: { matchCounter: 0, ...(parsed.meta ?? {}) },
        };
      } else {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      }
    } catch (err) {
      this.log.error("[store] failed to load", this.filePath, err);
    }
    return this.data;
  }

  markDirty() {
    this._dirty = true;
    if (!this.filePath || this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, this.saveDelayMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
  }

  flush() {
    if (!this.filePath || !this._dirty) return;
    this._dirty = false;
    const tmp = this.filePath + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      this.log.error("[store] failed to save", err);
      this._dirty = true;
    }
  }

  close() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.flush();
  }
}
