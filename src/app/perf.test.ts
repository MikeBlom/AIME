/**
 * Performance budgets suite (issue #40; docs/33-Performance-Budgets.md):
 * the budget comparator flags regressions with named, actionable violations
 * (FR-PERF-010), the rolling profiler aggregates step costs into the debug
 * overlay without touching behavior (FR-PERF-006/007), and the CI smoke run
 * boots the real reference pack headless and holds measured costs under the
 * enforcement thresholds (FR-PERF-008/009).
 *
 * Wall-clock measurement lives only in this harness (NFR-PERF-002); engine
 * code stays clock-free under the host-coupling gate.
 */
import { describe, expect, it } from 'vitest';
import { createHeadlessPlatform } from '../platform';
import { captureSave } from '../systems';
import { bootWorld } from './boot';
import { formatDebugOverlay } from './debug';
import { packFilesFromBundle } from './pack-bundle';
import {
  checkCiBudgets,
  createFrameProfiler,
  formatViolations,
  PERF_BUDGETS,
  PROFILE_WINDOW,
} from './perf';

const DT = 1 / 60;

describe('the budget comparator (FR-PERF-010)', () => {
  const green = { bootMs: 100, avgStepMs: 1, maxStepMs: 5 };

  it('passes measurements at or under every threshold', () => {
    expect(checkCiBudgets(green)).toEqual([]);
    expect(
      checkCiBudgets({
        bootMs: PERF_BUDGETS.ci.bootMs,
        avgStepMs: PERF_BUDGETS.ci.avgStepMs,
        maxStepMs: PERF_BUDGETS.ci.maxStepMs,
      }),
    ).toEqual([]);
  });

  it('catches a boot-time regression by name (AC: a perf regression is caught)', () => {
    const violations = checkCiBudgets({ ...green, bootMs: PERF_BUDGETS.ci.bootMs + 1 });
    expect(violations).toEqual([
      {
        budget: 'ci.bootMs',
        measuredMs: PERF_BUDGETS.ci.bootMs + 1,
        limitMs: PERF_BUDGETS.ci.bootMs,
      },
    ]);
  });

  it('catches average and worst step-cost regressions independently', () => {
    expect(checkCiBudgets({ ...green, avgStepMs: 9 }).map((v) => v.budget)).toEqual([
      'ci.avgStepMs',
    ]);
    expect(checkCiBudgets({ ...green, maxStepMs: 51 }).map((v) => v.budget)).toEqual([
      'ci.maxStepMs',
    ]);
    expect(
      checkCiBudgets({ bootMs: 9999, avgStepMs: 9999, maxStepMs: 9999 }).map((v) => v.budget),
    ).toEqual(['ci.bootMs', 'ci.avgStepMs', 'ci.maxStepMs']);
  });

  it('formats violations as actionable lines (NFR-PERF-003)', () => {
    const text = formatViolations(checkCiBudgets({ ...green, avgStepMs: 12.345 }));
    expect(text).toContain('ci.avgStepMs');
    expect(text).toContain('12.35ms');
    expect(text).toContain('8.00ms');
  });
});

describe('the rolling profiler (FR-PERF-006)', () => {
  it('aggregates average and worst over the recorded window', () => {
    const profiler = createFrameProfiler();
    expect(profiler.summary()).toEqual({
      windowSize: PROFILE_WINDOW,
      frames: 0,
      avgMs: 0,
      worstMs: 0,
    });
    profiler.record(1);
    profiler.record(2);
    profiler.record(6);
    expect(profiler.summary()).toEqual({
      windowSize: PROFILE_WINDOW,
      frames: 3,
      avgMs: 3,
      worstMs: 6,
    });
  });

  it('evicts old samples past the window and ignores invalid ones', () => {
    const profiler = createFrameProfiler(4);
    profiler.record(100); // will fall out of the window
    for (const value of [Number.NaN, -1, Number.POSITIVE_INFINITY]) profiler.record(value);
    for (let i = 0; i < 4; i += 1) profiler.record(2);
    expect(profiler.summary()).toEqual({ windowSize: 4, frames: 4, avgMs: 2, worstMs: 2 });
  });
});

describe('the profiling overlay (FR-PERF-006/007)', () => {
  function boot() {
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: 11 });
    return { platform, handle };
  }

  it('surfaces rolling step statistics against the budget in the overlay', () => {
    const { platform, handle } = boot();
    const stop = handle.start();
    for (let i = 0; i < 5; i += 1) platform.timers.tick(DT);
    stop();

    const snapshot = handle.debugSnapshot();
    expect(snapshot.profile?.frames).toBe(5);
    expect(snapshot.profile?.windowSize).toBe(PROFILE_WINDOW);
    const overlay = formatDebugOverlay(snapshot);
    expect(overlay).toContain('profile: step avg');
    expect(overlay).toContain(`budget ${PERF_BUDGETS.stepMs.laptop.toFixed(1)}ms`);
  });

  it('changes nothing about simulation: worlds with and without an overlay consumer match', () => {
    const overlayTexts: string[] = [];
    const platformA = createHeadlessPlatform({ width: 640, height: 360 });
    const handleA = bootWorld({
      platform: platformA,
      packFiles: packFilesFromBundle(),
      seed: 11,
      onOverlayText: (text) => overlayTexts.push(text),
    });
    const platformB = createHeadlessPlatform({ width: 640, height: 360 });
    const handleB = bootWorld({ platform: platformB, packFiles: packFilesFromBundle(), seed: 11 });

    const stopA = handleA.start();
    const stopB = handleB.start();
    for (let i = 0; i < 30; i += 1) {
      platformA.timers.tick(DT);
      platformB.timers.tick(DT);
    }
    stopA();
    stopB();

    expect(overlayTexts.length).toBe(30); // the consumer really ran
    const pack = { id: 'pack.reference', version: '0.1.0' };
    expect(captureSave(handleA.world, pack)).toEqual(captureSave(handleB.world, pack));
  });
});

describe('the CI perf smoke run (FR-PERF-008/009)', () => {
  it('boots the reference pack and holds the enforcement thresholds', () => {
    // Wall-clock measurement is confined to this harness. Each driven frame
    // at the fixed dt executes exactly one simulation step plus headless
    // presentation, so the per-frame cost measured here upper-bounds the
    // per-step cost the thresholds guard.
    const bootStart = performance.now();
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: 11 });
    const stop = handle.start();
    platform.timers.tick(DT); // first presented frame completes the boot span
    const bootMs = performance.now() - bootStart;

    const frameCosts: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      const before = performance.now();
      platform.timers.tick(DT);
      frameCosts.push(performance.now() - before);
    }
    stop();

    const avgStepMs = frameCosts.reduce((sum, cost) => sum + cost, 0) / frameCosts.length;
    const maxStepMs = frameCosts.reduce((worst, cost) => Math.max(worst, cost), 0);
    const violations = checkCiBudgets({ bootMs, avgStepMs, maxStepMs });
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
