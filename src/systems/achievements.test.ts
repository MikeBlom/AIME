/**
 * Achievements System suite (issue #32): content-defined unlock rules
 * evaluated over progression state and building visits, exactly-once
 * unlocks with non-intrusive feedback (AC1), and unlock state that
 * persists across save/load without replaying feedback (AC2).
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { UnlockRule } from './achievements';
import {
  ACHIEVEMENT,
  ACHIEVEMENT_STATE,
  ACHIEVEMENT_UNLOCKED,
  createAchievementsSystem,
  LOCKED_ACHIEVEMENT,
  readUnlockRule,
  TOAST_SECONDS,
} from './achievements';
import { BUILDING_ENTERED } from './building';
import { createProgressionSystem, PROGRESSION } from './progression';
import { SYSTEM_RESTORED } from './quest';
import { applySave, captureSave, PROGRESSION_SLICES } from './saveload';
import { UI_HINT } from './ui';

const DT = 1 / 60;

function makeContext(): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: true }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
}

function spawnAchievement(
  context: SystemContext,
  unlock: UnlockRule | null,
  id = 'achievement.test-first',
) {
  const achievement = context.world.createEntity();
  context.world.addComponent(achievement, ACHIEVEMENT, {
    achievementId: id,
    titleKey: `${id}.title`,
    descriptionKey: null,
    unlock,
  });
  context.world.addComponent(achievement, ACHIEVEMENT_STATE, LOCKED_ACHIEVEMENT);
  return achievement;
}

function setProgression(
  context: SystemContext,
  partial: Partial<{
    restored: string[];
    quests: string[];
    capabilities: string[];
    items: string[];
  }>,
) {
  const entity = context.world.query(PROGRESSION)[0] ?? context.world.createEntity();
  context.world.addComponent(entity, PROGRESSION, {
    restored: partial.restored ?? [],
    quests: partial.quests ?? [],
    capabilities: partial.capabilities ?? [],
    items: partial.items ?? [],
  });
}

const stateOf = (context: SystemContext, entity: EntityId) =>
  context.world.getComponent(entity, ACHIEVEMENT_STATE);

describe('readUnlockRule (content seam, FR-ACH-002)', () => {
  it('parses every rule kind and rejects malformed blocks', () => {
    expect(readUnlockRule({ kind: 'restored-count', count: 2 })).toEqual({
      kind: 'restored-count',
      count: 2,
    });
    expect(readUnlockRule({ kind: 'quest-completed', ref: 'quest.q' })).toEqual({
      kind: 'quest-completed',
      ref: 'quest.q',
    });
    expect(readUnlockRule({ kind: 'building-entered', ref: 'building.b' })).toEqual({
      kind: 'building-entered',
      ref: 'building.b',
    });
    expect(readUnlockRule(undefined)).toBeNull();
    expect(readUnlockRule({ kind: 'unknown-kind', ref: 'x.y' })).toBeNull();
    expect(readUnlockRule({ kind: 'restored-count', count: 0 })).toBeNull();
    expect(readUnlockRule({ kind: 'restored-region' })).toBeNull();
  });
});

describe('unlocks with feedback (AC1, FR-ACH-003/004/006)', () => {
  it('unlocks on a satisfied progression rule, exactly once, with toast and announcement', () => {
    const context = makeContext();
    const system = createAchievementsSystem();
    system.init(context);
    const achievement = spawnAchievement(context, { kind: 'restored-count', count: 1 });
    const unlocked: unknown[] = [];
    const hints: unknown[] = [];
    context.events.subscribe(ACHIEVEMENT_UNLOCKED, (event) => unlocked.push(event.payload));
    context.events.subscribe(UI_HINT, (event) => hints.push(event.payload.textKey));

    system.update(DT, context); // nothing restored yet: still locked
    expect(stateOf(context, achievement)?.unlocked).toBe(false);

    setProgression(context, { restored: ['region.test-yard'] });
    system.update(DT, context);
    system.update(DT, context); // re-check: settled, no re-announce
    context.events.flushDeferred();

    expect(stateOf(context, achievement)?.unlocked).toBe(true);
    expect(unlocked).toEqual([
      { achievementId: 'achievement.test-first', titleKey: 'achievement.test-first.title' },
    ]);
    expect(hints).toEqual(['achievement.test-first.title']);
  });

  it('clears its toast after TOAST_SECONDS of simulation time', () => {
    const context = makeContext();
    const system = createAchievementsSystem();
    system.init(context);
    spawnAchievement(context, { kind: 'restored-count', count: 1 });
    const hints: unknown[] = [];
    context.events.subscribe(UI_HINT, (event) => hints.push(event.payload.textKey));

    setProgression(context, { restored: ['region.test-yard'] });
    const steps = Math.ceil(TOAST_SECONDS / DT) + 2;
    for (let i = 0; i < steps; i += 1) system.update(DT, context);
    context.events.flushDeferred();

    expect(hints).toEqual(['achievement.test-first.title', null]);
  });

  it('unlocks each rule kind on its own condition', () => {
    const context = makeContext();
    const system = createAchievementsSystem();
    system.init(context);
    const byRegion = spawnAchievement(
      context,
      { kind: 'restored-region', ref: 'region.a' },
      'achievement.test-region',
    );
    const byQuest = spawnAchievement(
      context,
      { kind: 'quest-completed', ref: 'quest.q' },
      'achievement.test-quest',
    );
    const byCapability = spawnAchievement(
      context,
      { kind: 'capability-unlocked', ref: 'capability.c' },
      'achievement.test-capability',
    );
    const byItem = spawnAchievement(
      context,
      { kind: 'item-added', ref: 'item.i' },
      'achievement.test-item',
    );
    const ruleless = spawnAchievement(context, null, 'achievement.test-ruleless');

    setProgression(context, {
      restored: ['region.a'],
      quests: ['quest.q'],
      capabilities: ['capability.c'],
      items: ['item.i'],
    });
    system.update(DT, context);

    for (const entity of [byRegion, byQuest, byCapability, byItem]) {
      expect(stateOf(context, entity)?.unlocked).toBe(true);
    }
    expect(stateOf(context, ruleless)?.unlocked).toBe(false);
  });

  it('unlocks on entering the named building (FR-ACH-002 building-entered)', () => {
    const context = makeContext();
    const system = createAchievementsSystem();
    system.init(context);
    const achievement = spawnAchievement(
      context,
      { kind: 'building-entered', ref: 'building.test-house' },
      'achievement.test-visit',
    );

    context.events.publish(BUILDING_ENTERED, { buildingId: 'building.other', entityId: 1 });
    context.events.flushDeferred();
    system.update(DT, context);
    expect(stateOf(context, achievement)?.unlocked).toBe(false);

    context.events.publish(BUILDING_ENTERED, { buildingId: 'building.test-house', entityId: 1 });
    context.events.flushDeferred();
    system.update(DT, context);
    expect(stateOf(context, achievement)?.unlocked).toBe(true);
  });

  it('unlocks end-to-end through the real Progression System', () => {
    const context = makeContext();
    const progression = createProgressionSystem();
    const achievements = createAchievementsSystem();
    progression.init(context);
    achievements.init(context);
    const achievement = spawnAchievement(context, { kind: 'restored-count', count: 1 });

    context.events.publish(SYSTEM_RESTORED, { questId: 'quest.q', regionId: 'region.test-yard' });
    context.events.flushDeferred();
    progression.update(DT, context);
    achievements.update(DT, context);

    expect(stateOf(context, achievement)?.unlocked).toBe(true);
  });
});

describe('persistence (AC2, FR-ACH-005)', () => {
  it('unlock state is a persisted slice, round-trips, and replays no feedback', () => {
    expect(PROGRESSION_SLICES).toContain(ACHIEVEMENT_STATE);

    const live = makeContext();
    const liveSystem = createAchievementsSystem();
    liveSystem.init(live);
    spawnAchievement(live, { kind: 'restored-count', count: 1 });
    setProgression(live, { restored: ['region.test-yard'] });
    liveSystem.update(DT, live);

    const pack = { id: 'pack.reference', version: '0.1.0' };
    const envelope = captureSave(live.world, pack, [ACHIEVEMENT_STATE]);

    // A fresh world spawns the same entities at the same ids; the save
    // overlays the unlocked flag before the first update.
    const resumed = makeContext();
    const resumedSystem = createAchievementsSystem();
    resumedSystem.init(resumed);
    const achievement = spawnAchievement(resumed, { kind: 'restored-count', count: 1 });
    setProgression(resumed, { restored: ['region.test-yard'] });
    applySave(resumed.world, envelope, [ACHIEVEMENT_STATE]);

    const unlocked: unknown[] = [];
    const hints: unknown[] = [];
    resumed.events.subscribe(ACHIEVEMENT_UNLOCKED, (event) => unlocked.push(event.payload));
    resumed.events.subscribe(UI_HINT, (event) => hints.push(event.payload.textKey));
    resumedSystem.update(DT, resumed);
    resumed.events.flushDeferred();

    expect(stateOf(resumed, achievement)?.unlocked).toBe(true);
    // Already unlocked: the restored world replays no announcement, no toast.
    expect(unlocked).toEqual([]);
    expect(hints).toEqual([]);
  });
});
