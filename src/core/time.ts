/**
 * TimeService — simulation time as an explicit, injected input
 * (docs/02-System-Architecture.md, "The Runtime Loop"; NFR-ARCH-001).
 *
 * Systems never read a wall clock; they read this service, which only the
 * runtime loop advances. Simulation time is derived from the fixed-step
 * count, not accumulated floats, so long sessions do not drift.
 */
export class TimeService {
  /** Seconds of simulation each fixed step advances (FR-ARCH-021). */
  readonly fixedDt: number;
  #steps = 0;
  #frames = 0;

  constructor(fixedDt: number) {
    if (!Number.isFinite(fixedDt) || fixedDt <= 0) {
      throw new Error(`fixedDt must be a positive number of seconds, got ${fixedDt}`);
    }
    this.fixedDt = fixedDt;
  }

  /** Simulation seconds elapsed: steps × fixedDt, exact by construction. */
  get now(): number {
    return this.#steps * this.fixedDt;
  }

  /** Fixed simulation steps run so far. */
  get step(): number {
    return this.#steps;
  }

  /** Host frames processed so far. */
  get frame(): number {
    return this.#frames;
  }

  /** Advance one fixed step. Loop-owned: Systems read time, never advance it. */
  advanceStep(): void {
    this.#steps += 1;
  }

  /** Advance one host frame. Loop-owned: Systems read time, never advance it. */
  advanceFrame(): void {
    this.#frames += 1;
  }
}
