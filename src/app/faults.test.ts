/**
 * Fault-reporting suite (issue #42; docs/43-Observability-and-Error-Handling.md):
 * an injected System fault is isolated, reported once with full context,
 * and the world keeps running (AC1; FR-ARCH-029, FR-OBS-001); a
 * crash-looping System is rate-limited to summaries (FR-OBS-002); and the
 * hardened overlay surfaces the most recent fault (FR-OBS-004). Behavior
 * neutrality of the overlay path (AC2; FR-ARCH-031) is pinned by the A/B
 * world comparison in perf.test.ts; the reporter shares the proof by
 * construction — it only reads what the loop already recorded.
 */
import { describe, expect, it } from 'vitest';
import type { System, SystemFault } from '../core';
import { EntityStore, EventBus, ModuleRegistry, RuntimeLoop } from '../core';
import { createHeadlessPlatform } from '../platform';
import { bootWorld } from './boot';
import { buildDebugSnapshot, formatDebugOverlay } from './debug';
import {
  createFaultReporter,
  faultMessage,
  formatFault,
  FULL_REPORTS_PER_SYSTEM,
  SUMMARY_EVERY,
} from './faults';
import { packFilesFromBundle } from './pack-bundle';

const DT = 1 / 60;

function fault(overrides: Partial<SystemFault> = {}): SystemFault {
  return {
    systemId: 'sys.broken',
    step: 7,
    frame: 3,
    error: new Error('exploded'),
    ...overrides,
  };
}

describe('fault formatting (FR-OBS-001, NFR-OBS-003)', () => {
  it('reports one greppable line with system, step, frame, and error', () => {
    expect(formatFault(fault())).toBe('fault: system=sys.broken step=7 frame=3 error=exploded');
  });

  it('floors non-Error throws to String()', () => {
    expect(faultMessage('boom')).toBe('boom');
    expect(faultMessage(42)).toBe('42');
    expect(formatFault(fault({ error: 'boom' }))).toContain('error=boom');
  });
});

describe('rate limiting (FR-OBS-002, FR-OBS-007)', () => {
  it('reports the first faults in full, then periodic summaries with totals', () => {
    const lines: string[] = [];
    const reporter = createFaultReporter((line) => lines.push(line));
    const total = FULL_REPORTS_PER_SYSTEM + 2 * SUMMARY_EVERY;
    for (let i = 0; i < total; i += 1) reporter.handle(fault({ step: i }));

    expect(lines).toHaveLength(FULL_REPORTS_PER_SYSTEM + 2);
    expect(lines[0]).toBe('fault: system=sys.broken step=0 frame=3 error=exploded');
    expect(lines.at(-1)).toContain(`${total} total`);
    expect(lines.at(-1)).toContain('repeating');
  });

  it('throttles per System: a second System gets its own full reports', () => {
    const lines: string[] = [];
    const reporter = createFaultReporter((line) => lines.push(line));
    for (let i = 0; i < 10; i += 1) reporter.handle(fault());
    reporter.handle(fault({ systemId: 'sys.other' }));
    expect(lines).toHaveLength(FULL_REPORTS_PER_SYSTEM + 1);
    expect(lines.at(-1)).toContain('system=sys.other');
  });
});

describe('an injected fault is isolated and the world keeps running (AC1)', () => {
  function makeRegistry() {
    const registry = new ModuleRegistry();
    let healthyUpdates = 0;
    const broken: System = {
      id: 'sys.broken',
      dependencies: [],
      init: () => undefined,
      update: () => {
        throw new Error('injected');
      },
      teardown: () => undefined,
    };
    const healthy: System = {
      id: 'sys.healthy',
      dependencies: [],
      init: () => undefined,
      update: () => {
        healthyUpdates += 1;
      },
      teardown: () => undefined,
    };
    registry.register({ id: 'plugin.broken', systems: [broken] });
    registry.register({ id: 'plugin.healthy', systems: [healthy] });
    return { registry, healthyUpdates: () => healthyUpdates };
  }

  it('reports with context while the healthy System keeps updating', () => {
    const { registry, healthyUpdates } = makeRegistry();
    const lines: string[] = [];
    const reporter = createFaultReporter((line) => lines.push(line));
    const loop = new RuntimeLoop(
      registry,
      {
        world: new EntityStore(),
        events: new EventBus(),
        scheduler: { schedule: (task: () => void) => task() },
        platform: {},
      },
      { fixedDt: DT, seed: 1, onFault: (f) => reporter.handle(f) },
    );
    for (let i = 0; i < 10; i += 1) loop.frame(DT);

    expect(healthyUpdates()).toBe(10); // the world kept running (FR-ARCH-029)
    expect(loop.faults.length).toBe(10); // the loop's bounded log has them all
    expect(lines).toHaveLength(FULL_REPORTS_PER_SYSTEM); // the sink stayed legible
    expect(lines[0]).toContain('system=sys.broken');
    expect(lines[0]).toContain('step=0');
    expect(lines[0]).toContain('error=injected');
  });
});

describe('the hardened overlay (FR-OBS-004)', () => {
  it('shows no fault context on a clean world', () => {
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    const handle = bootWorld({ platform, packFiles: packFilesFromBundle(), seed: 11 });
    const stop = handle.start();
    platform.timers.tick(DT);
    stop();

    const clean = handle.debugSnapshot();
    expect(clean.lastFault).toBeNull();
    expect(formatDebugOverlay(clean)).toContain('faults 0');
  });

  it('surfaces the most recent fault with context', () => {
    const registry = new ModuleRegistry();
    registry.register({
      id: 'plugin.test-broken',
      systems: [
        {
          id: 'sys.test-broken',
          dependencies: [],
          init: () => undefined,
          update: () => {
            throw new Error('overlay probe');
          },
          teardown: () => undefined,
        },
      ],
    });
    const events = new EventBus();
    const loop = new RuntimeLoop(
      registry,
      {
        world: new EntityStore(),
        events,
        scheduler: { schedule: (task: () => void) => task() },
        platform: {},
      },
      { fixedDt: DT, seed: 1 },
    );
    loop.frame(DT);

    const snapshot = buildDebugSnapshot(loop, registry, events);
    expect(snapshot.lastFault?.systemId).toBe('sys.test-broken');
    expect(snapshot.lastFault?.message).toBe('overlay probe');
    const overlay = formatDebugOverlay(snapshot);
    expect(overlay).toContain('last sys.test-broken@');
    expect(overlay).toContain('overlay probe');
  });
});

describe('the report sink is behavior-neutral (FR-OBS-006)', () => {
  it('a world with a fault sink matches one without', () => {
    const run = (withSink: boolean) => {
      const platform = createHeadlessPlatform({ width: 640, height: 360 });
      const handle = bootWorld({
        platform,
        packFiles: packFilesFromBundle(),
        seed: 11,
        ...(withSink ? { onFaultLine: () => undefined } : {}),
      });
      const stop = handle.start();
      platform.input.press('ArrowRight');
      for (let i = 0; i < 30; i += 1) platform.timers.tick(DT);
      stop();
      return handle.debugSnapshot();
    };
    const a = run(true);
    const b = run(false);
    expect(a.step).toBe(b.step);
    expect(a.faultCount).toBe(0);
    expect(b.faultCount).toBe(0);
  });
});
