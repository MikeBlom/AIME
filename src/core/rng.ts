/**
 * RngService — the seedable randomness source (NFR-ARCH-001).
 *
 * All engine randomness flows through this service so replays are
 * deterministic: same seed, same call sequence, same numbers. The generator
 * is mulberry32 — small, fast, and reproducible across hosts because it
 * only uses 32-bit integer ops and Math.fround-free arithmetic.
 */
export class RngService {
  #state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error(`RNG seed must be a finite number, got ${seed}`);
    }
    this.#state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`nextInt bound must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Serializable generator state, captured for save/load and replay. */
  get state(): number {
    return this.#state;
  }

  /** Restore a previously captured state (replay/load entry point). */
  restore(state: number): void {
    this.#state = state >>> 0;
  }
}
