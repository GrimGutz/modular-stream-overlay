/**
 * Undo/redo for one editor draft, as JSON snapshots. `baseline` is the saved version, so
 * stepping back to it leaves the draft clean. No DOM or Foundry dependency.
 */
export const HISTORY_LIMIT = 100;
// Edits closer together than this become one step, so a drag or a typed value undoes at once.
export const HISTORY_DELAY = 400;

export class DraftHistory {
  constructor(snapshot = null) {
    this.undo = [];
    this.redo = [];
    this.current = snapshot;
    this.baseline = snapshot;
  }

  get dirty() { return this.current !== this.baseline; }

  /** Record a changed draft as a new step; the oldest steps beyond the limit are dropped. */
  record(snapshot) {
    if (snapshot === this.current) return false;
    this.undo.push(this.current);
    if (this.undo.length > HISTORY_LIMIT) this.undo.shift();
    this.current = snapshot;
    this.redo = [];
    return true;
  }

  /** Move one step "undo" or "redo"; returns the snapshot to restore, or null at the end. */
  step(direction) {
    const from = direction === "undo" ? this.undo : this.redo;
    const to = direction === "undo" ? this.redo : this.undo;
    if (!from.length) return null;
    to.push(this.current);
    this.current = from.pop();
    return this.current;
  }
}
