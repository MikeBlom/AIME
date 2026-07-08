import { describe, expect, it } from 'vitest';
import { RngService } from './rng';
import { TimeService } from './time';

describe('RngService (NFR-ARCH-001)', () => {
  it('same seed yields the same sequence', () => {
    const a = new RngService(123);
    const b = new RngService(123);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('different seeds yield different sequences', () => {
    const a = new RngService(1);
    const b = new RngService(2);
    expect([a.next(), a.next()]).not.toEqual([b.next(), b.next()]);
  });

  it('captured state restores mid-sequence for replay and save/load', () => {
    const rng = new RngService(7);
    rng.next();
    const state = rng.state;
    const ahead = [rng.next(), rng.next()];
    rng.restore(state);
    expect([rng.next(), rng.next()]).toEqual(ahead);
  });

  it('next() stays in [0, 1) and nextInt() in [0, bound)', () => {
    const rng = new RngService(99);
    for (let i = 0; i < 1000; i += 1) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.nextInt(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('rejects invalid seeds and bounds loudly', () => {
    expect(() => new RngService(Number.NaN)).toThrowError(/seed/);
    const rng = new RngService(1);
    expect(() => rng.nextInt(0)).toThrowError(/positive integer/);
  });
});

describe('TimeService (NFR-ARCH-001)', () => {
  it('derives simulation time from the step count, drift-free', () => {
    const time = new TimeService(1 / 60);
    for (let i = 0; i < 3600; i += 1) time.advanceStep();
    expect(time.now).toBe(3600 * (1 / 60));
    expect(time.step).toBe(3600);
  });

  it('rejects a non-positive fixed step loudly', () => {
    expect(() => new TimeService(0)).toThrowError(/positive/);
  });
});
