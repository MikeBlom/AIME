/**
 * Accessibility System suite (issue #37; docs/34-Accessibility.md): the
 * settings slice is owned here and mutated only by control events, remap
 * requests rewrite one action's bindings as pure data (FR-A11Y-006), and
 * malformed requests are ignored without faulting (FR-ARCH-008).
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import {
  ACCESSIBILITY_CONTROL,
  ACCESSIBILITY_SETTINGS,
  accessibilitySettingsOf,
  createAccessibilitySystem,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  INPUT_REMAP,
  reducedMotionOf,
} from './accessibility';
import { activeBindings, DEFAULT_BINDINGS, INPUT_BINDINGS } from './input';
import { applySave, captureSave } from './saveload';

const DT = 1 / 60;

interface Harness {
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly context: SystemContext;
  readonly system: ReturnType<typeof createAccessibilitySystem>;
  /** One simulated fixed step: flush deferred events, then update. */
  step(): void;
}

function harness(): Harness {
  const world = new EntityStore();
  const events = new EventBus({ logEnabled: false });
  const context: SystemContext = {
    world,
    events,
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const system = createAccessibilitySystem();
  system.init(context);
  return {
    world,
    events,
    context,
    system,
    step: () => {
      events.flushDeferred();
      system.update(DT, context);
    },
  };
}

describe('settings slice ownership (FR-A11Y-001)', () => {
  it('spawns the defaults at init: narration on, full motion (FR-A11Y-009)', () => {
    const h = harness();
    expect(h.world.query(ACCESSIBILITY_SETTINGS)).toHaveLength(1);
    expect(accessibilitySettingsOf(h.world)).toEqual({ reducedMotion: false, narration: true });
    expect(reducedMotionOf(h.world)).toBe(false);
  });

  it('applies control events on update; unknown and invalid fields are ignored', () => {
    const h = harness();
    h.events.publish(ACCESSIBILITY_CONTROL, { reducedMotion: true });
    h.step();
    expect(accessibilitySettingsOf(h.world)).toEqual({ reducedMotion: true, narration: true });

    h.events.publish(ACCESSIBILITY_CONTROL, { narration: false, bogus: 1 } as never);
    h.step();
    expect(accessibilitySettingsOf(h.world)).toEqual({ reducedMotion: true, narration: false });

    for (const payload of [null, 7, [], { reducedMotion: 'yes' }]) {
      h.events.publish(ACCESSIBILITY_CONTROL, payload as never);
      expect(() => h.step()).not.toThrow();
    }
    expect(accessibilitySettingsOf(h.world)).toEqual({ reducedMotion: true, narration: false });
  });

  it('re-init adopts the existing slice instead of spawning a second one', () => {
    const h = harness();
    h.events.publish(ACCESSIBILITY_CONTROL, { reducedMotion: true });
    h.step();
    h.system.teardown(h.context);
    h.system.init(h.context);
    expect(h.world.query(ACCESSIBILITY_SETTINGS)).toHaveLength(1);
    expect(reducedMotionOf(h.world)).toBe(true); // adopted, not reset
  });

  it('defaults by query when no System spawned the slice', () => {
    expect(accessibilitySettingsOf(new EntityStore())).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS);
  });
});

describe('remap requests (FR-A11Y-006, FR-INP-003)', () => {
  it('spawns the bindings holder with engine defaults at init', () => {
    const h = harness();
    expect(h.world.query(INPUT_BINDINGS)).toHaveLength(1);
    expect(activeBindings(h.world)).toEqual(DEFAULT_BINDINGS);
  });

  it('replaces exactly one action, leaving every other binding untouched', () => {
    const h = harness();
    h.events.publish(INPUT_REMAP, { action: 'move-left', codes: ['KeyJ'] });
    h.step();
    const table = activeBindings(h.world);
    expect(table['move-left']).toEqual(['KeyJ']); // defaults unbound
    expect(table['move-right']).toEqual(DEFAULT_BINDINGS['move-right']);
    expect(table['interact']).toEqual(DEFAULT_BINDINGS['interact']);
  });

  it('applies several requests in arrival order, deduplicating and capping codes', () => {
    const h = harness();
    h.events.publish(INPUT_REMAP, { action: 'interact', codes: ['KeyF'] });
    h.events.publish(INPUT_REMAP, {
      action: 'interact',
      codes: ['KeyG', 'KeyG', 'KeyH', 'KeyI', 'KeyJ', 'KeyK'],
    });
    h.step();
    // Last request wins; duplicates collapse; the table caps per action.
    expect(activeBindings(h.world)['interact']).toEqual(['KeyG', 'KeyH', 'KeyI', 'KeyJ']);
  });

  it('ignores unknown actions and malformed requests without faulting (FR-ARCH-008)', () => {
    const h = harness();
    for (const payload of [
      { action: 'fly', codes: ['KeyF'] }, // unknown action
      { action: 'interact', codes: [] }, // no codes
      { action: 'interact', codes: [3, ''] }, // no valid codes
      { action: 'interact' },
      { codes: ['KeyF'] },
      null,
      7,
    ]) {
      h.events.publish(INPUT_REMAP, payload as never);
      expect(() => h.step()).not.toThrow();
    }
    expect(activeBindings(h.world)).toEqual(DEFAULT_BINDINGS);
  });

  it('stops applying events after teardown', () => {
    const h = harness();
    h.system.teardown(h.context);
    h.events.publish(INPUT_REMAP, { action: 'move-left', codes: ['KeyJ'] });
    h.events.flushDeferred();
    h.system.update(DT, h.context);
    expect(activeBindings(h.world)['move-left']).toEqual(DEFAULT_BINDINGS['move-left']);
  });
});

describe('persistence (FR-A11Y-008, FR-ARCH-016)', () => {
  it('settings and remapped bindings survive a save/load round-trip', () => {
    const before = harness();
    before.events.publish(ACCESSIBILITY_CONTROL, { reducedMotion: true, narration: false });
    before.events.publish(INPUT_REMAP, { action: 'interact', codes: ['KeyF'] });
    before.step();
    const envelope = captureSave(before.world, { id: 'pack.test', version: '1.0.0' });

    // A fresh boot spawns the same slices at the same deterministic ids;
    // the saved values overlay them (the resume flow).
    const after = harness();
    const applied = applySave(after.world, envelope);
    expect(applied).toBeGreaterThanOrEqual(2);
    expect(accessibilitySettingsOf(after.world)).toEqual({
      reducedMotion: true,
      narration: false,
    });
    expect(activeBindings(after.world)['interact']).toEqual(['KeyF']);
  });
});
