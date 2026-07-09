/**
 * Analytics System suite (issue #39; docs/36-Analytics-and-Telemetry.md):
 * funnel milestones record once each as name + simulation time and nothing
 * else (AC1, FR-ANLY-002/003), the disable switch drops capture without
 * touching gameplay and never retro-fires (AC2, FR-ANLY-004), a sinkless
 * platform degrades silently (FR-ANLY-005), and captured milestones
 * survive a save round-trip (FR-ANLY-006).
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { HeadlessPlatform } from '../platform';
import { createHeadlessPlatform } from '../platform';
import {
  ANALYTICS_CONTROL,
  ANALYTICS_STATE,
  createAnalyticsSystem,
  MILESTONE_FIRST_DELIGHT,
  MILESTONE_FIRST_RESTORATION,
  MILESTONE_SHORT_VISIT,
} from './analytics';
import { INTENT_INTERACT } from './input';
import { REGION_STATE_CHANGED, SYSTEM_RESTORED } from './quest';
import { applySave, captureSave } from './saveload';

const DT = 1 / 60;

interface Harness {
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly context: SystemContext;
  readonly system: ReturnType<typeof createAnalyticsSystem>;
  readonly platform: HeadlessPlatform;
  readonly time: TimeService;
  step(): void;
}

function harness(platform: HeadlessPlatform | Record<string, never> = createHeadlessPlatform()) {
  const world = new EntityStore();
  const events = new EventBus({ logEnabled: false });
  const time = new TimeService(DT);
  const context: SystemContext = {
    world,
    events,
    scheduler: { schedule: (task: () => void) => task() },
    platform,
    time,
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const system = createAnalyticsSystem();
  system.init(context);
  return {
    world,
    events,
    context,
    system,
    platform: platform as HeadlessPlatform,
    time,
    step: () => {
      events.flushDeferred();
      system.update(DT, context);
      time.advanceStep();
    },
  } as Harness;
}

function milestonesOf(h: Harness): { readonly [milestone: string]: number } {
  const entity = h.world.query(ANALYTICS_STATE)[0];
  return (
    (entity === undefined ? undefined : h.world.getComponent(entity, ANALYTICS_STATE))
      ?.milestones ?? {}
  );
}

describe('funnel capture (AC1: milestones without personal data)', () => {
  it('records each milestone once, as its name plus simulation seconds only', () => {
    const h = harness();
    h.step(); // advance time so the metric value is distinguishable
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    h.events.publish(SYSTEM_RESTORED, { questId: 'quest.q', regionId: 'region.r' });
    h.events.publish(REGION_STATE_CHANGED, { regionId: 'region.r', state: 'online' });
    h.step();

    expect(h.platform.telemetry.records).toEqual([
      { metric: `funnel.${MILESTONE_FIRST_DELIGHT}`, value: 1 * DT },
      { metric: `funnel.${MILESTONE_FIRST_RESTORATION}`, value: 2 * DT },
      { metric: `funnel.${MILESTONE_SHORT_VISIT}`, value: 2 * DT },
    ]);
    // Nothing from the payloads (quest ids, region ids) crossed the sink.
    expect(JSON.stringify(h.platform.telemetry.records)).not.toContain('region.r');
  });

  it('a repeated milestone event records nothing new (first occurrence only)', () => {
    const h = harness();
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    h.events.publish(INTENT_INTERACT, {});
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.platform.telemetry.records).toHaveLength(1);
  });

  it('a region state change that is not online fires no milestone', () => {
    const h = harness();
    h.events.publish(REGION_STATE_CHANGED, { regionId: 'region.r', state: 'offline' });
    h.step();
    expect(h.platform.telemetry.records).toEqual([]);
    expect(milestonesOf(h)).toEqual({});
  });
});

describe('the disable switch (AC2: never blocks gameplay)', () => {
  it('disabled capture drops milestones and re-enabling does not retro-fire', () => {
    const h = harness();
    h.events.publish(ANALYTICS_CONTROL, { enabled: false });
    h.step();
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.platform.telemetry.records).toEqual([]);
    expect(milestonesOf(h)).toEqual({});

    h.events.publish(ANALYTICS_CONTROL, { enabled: true });
    h.step();
    expect(h.platform.telemetry.records).toEqual([]); // nothing retroactive

    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.platform.telemetry.records).toHaveLength(1); // fresh hits count again
  });

  it('a disable arriving with a milestone in the same tick wins deterministically', () => {
    const h = harness();
    h.events.publish(INTENT_INTERACT, {});
    h.events.publish(ANALYTICS_CONTROL, { enabled: false });
    h.step();
    expect(h.platform.telemetry.records).toEqual([]);
  });

  it('ignores malformed control payloads without faulting (FR-ARCH-008)', () => {
    const h = harness();
    for (const payload of [null, 7, [], { enabled: 'yes' }]) {
      h.events.publish(ANALYTICS_CONTROL, payload as never);
      expect(() => h.step()).not.toThrow();
    }
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.platform.telemetry.records).toHaveLength(1); // still enabled
  });
});

describe('platform independence (FR-ANLY-005)', () => {
  it('a platform without a telemetry sink degrades to no capture, no fault', () => {
    const h = harness({});
    h.events.publish(INTENT_INTERACT, {});
    expect(() => h.step()).not.toThrow();
    // The slice still tracks the milestone, so behavior is host-independent.
    expect(Object.keys(milestonesOf(h))).toEqual([MILESTONE_FIRST_DELIGHT]);
  });
});

describe('persistence (FR-ANLY-006)', () => {
  it('captured milestones survive a save round-trip and never double-count', () => {
    const before = harness();
    before.events.publish(INTENT_INTERACT, {});
    before.step();
    const envelope = captureSave(before.world, { id: 'pack.test', version: '1.0.0' });

    const after = harness();
    expect(applySave(after.world, envelope)).toBeGreaterThanOrEqual(1);
    after.events.publish(INTENT_INTERACT, {});
    after.step();
    expect(after.platform.telemetry.records).toEqual([]); // already counted
    expect(Object.keys(milestonesOf(after))).toEqual([MILESTONE_FIRST_DELIGHT]);
  });
});
