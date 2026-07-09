/**
 * Inventory and Progression System suite (issue #31): the event-driven
 * progression slice — restorations recorded and persisted (AC1), mutation
 * only through events end-to-end via the real quest engine (AC2), and
 * content-declared grants of capabilities and inventory items.
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import {
  CAPABILITY_UNLOCKED,
  createProgressionSystem,
  EMPTY_PROGRESSION,
  ITEM_ADDED,
  PROGRESSION,
  PROGRESSION_CHANGED,
} from './progression';
import type { QuestDefinition } from './quest';
import {
  createQuestSystem,
  initialQuestState,
  OBJECTIVE_RESOLVED,
  QUEST,
  QUEST_COMPLETED,
  QUEST_STATE,
  SYSTEM_RESTORED,
} from './quest';
import { applySave, captureSave, PROGRESSION_SLICES } from './saveload';

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

function spawnQuest(context: SystemContext, definition: QuestDefinition) {
  const quest = context.world.createEntity();
  context.world.addComponent(quest, QUEST, definition);
  context.world.addComponent(quest, QUEST_STATE, initialQuestState(definition));
  return quest;
}

const GRANTING_QUEST: QuestDefinition = {
  questId: 'quest.test-restoration',
  titleKey: 'quest.test-restoration.title',
  regionRef: 'region.test-yard',
  objectives: [{ id: 'obj.only', descriptionKey: 'quest.test-restoration.obj.only' }],
  emitsOnComplete: ['SystemRestored'],
  revealsKey: null,
  bypassAllowed: false,
  bypassRevealsKey: null,
  grantsCapabilities: ['capability.test-power'],
  grantsItems: ['item.test-key'],
};

const progressionOf = (context: SystemContext) => {
  for (const entity of context.world.query(PROGRESSION)) {
    const value = context.world.getComponent(entity, PROGRESSION);
    if (value !== undefined) return value;
  }
  return undefined;
};

describe('event-driven mutation (AC2, FR-INV-002)', () => {
  it('records a restoration from system.restored and announces the change', () => {
    const context = makeContext();
    const system = createProgressionSystem();
    system.init(context);
    const changes: unknown[] = [];
    context.events.subscribe(PROGRESSION_CHANGED, (event) => changes.push(event.payload));

    expect(progressionOf(context)).toEqual(EMPTY_PROGRESSION);
    context.events.publish(SYSTEM_RESTORED, {
      questId: 'quest.test-restoration',
      regionId: 'region.test-yard',
    });
    context.events.flushDeferred();
    system.update(DT, context);
    context.events.flushDeferred();

    expect(progressionOf(context)?.restored).toEqual(['region.test-yard']);
    expect(changes).toEqual([{ restored: 1, quests: 0, capabilities: 0, items: 0 }]);
  });

  it('repeated announcements are idempotent (FR-INV-006)', () => {
    const context = makeContext();
    const system = createProgressionSystem();
    system.init(context);
    const changes: unknown[] = [];
    context.events.subscribe(PROGRESSION_CHANGED, (event) => changes.push(event.payload));

    for (let i = 0; i < 3; i += 1) {
      context.events.publish(SYSTEM_RESTORED, { questId: 'quest.q', regionId: 'region.same' });
      context.events.flushDeferred();
      system.update(DT, context);
    }
    context.events.flushDeferred();
    expect(progressionOf(context)?.restored).toEqual(['region.same']);
    expect(changes).toHaveLength(1);
  });

  it('a quiet world never touches the slice', () => {
    const context = makeContext();
    const system = createProgressionSystem();
    system.init(context);
    const before = progressionOf(context);
    for (let i = 0; i < 5; i += 1) system.update(DT, context);
    // Same object reference: no write happened at all (FR-INV-002).
    expect(progressionOf(context)).toBe(before);
  });

  it('updates progression end-to-end through the real quest engine (AC2)', () => {
    const context = makeContext();
    const quest = createQuestSystem();
    const progression = createProgressionSystem();
    quest.init(context);
    progression.init(context);
    spawnQuest(context, GRANTING_QUEST);

    // A gameplay System reports the objective; the quest engine completes
    // the quest and announces; progression records — three Systems
    // coordinating through the bus alone (FR-ARCH-005).
    context.events.publish(OBJECTIVE_RESOLVED, {
      questId: 'quest.test-restoration',
      objectiveId: 'obj.only',
      outcome: 'solved',
    });
    context.events.flushDeferred(); // objective reaches the quest engine
    context.events.flushDeferred(); // completion + restoration reach progression
    progression.update(DT, context);

    expect(progressionOf(context)).toEqual({
      restored: ['region.test-yard'],
      quests: ['quest.test-restoration'],
      capabilities: ['capability.test-power'],
      items: ['item.test-key'],
    });
  });
});

describe('content-declared grants (FR-INV-003/004)', () => {
  it('unlocks a completed quest grants exactly once, with unlock events', () => {
    const context = makeContext();
    const system = createProgressionSystem();
    system.init(context);
    spawnQuest(context, GRANTING_QUEST);
    const unlocked: unknown[] = [];
    const added: unknown[] = [];
    context.events.subscribe(CAPABILITY_UNLOCKED, (event) => unlocked.push(event.payload));
    context.events.subscribe(ITEM_ADDED, (event) => added.push(event.payload));

    for (let i = 0; i < 2; i += 1) {
      context.events.publish(QUEST_COMPLETED, { questId: 'quest.test-restoration' });
      context.events.flushDeferred();
      system.update(DT, context);
    }
    context.events.flushDeferred();

    expect(progressionOf(context)?.capabilities).toEqual(['capability.test-power']);
    expect(progressionOf(context)?.items).toEqual(['item.test-key']);
    expect(unlocked).toEqual([
      { capabilityId: 'capability.test-power', questId: 'quest.test-restoration' },
    ]);
    expect(added).toEqual([{ itemId: 'item.test-key', questId: 'quest.test-restoration' }]);
  });

  it('an unknown quest still records its completion, granting nothing (FR-INV-007)', () => {
    const context = makeContext();
    const system = createProgressionSystem();
    system.init(context);

    context.events.publish(QUEST_COMPLETED, { questId: 'quest.never-spawned' });
    context.events.flushDeferred();
    system.update(DT, context);

    expect(progressionOf(context)).toEqual({
      restored: [],
      quests: ['quest.never-spawned'],
      capabilities: [],
      items: [],
    });
  });

  it('keeps every list ascending and duplicate-free (FR-INV-001)', () => {
    const context = makeContext();
    const system = createProgressionSystem();
    system.init(context);

    for (const regionId of ['region.zeta', 'region.alpha', 'region.zeta', 'region.mid']) {
      context.events.publish(SYSTEM_RESTORED, { questId: 'quest.q', regionId });
    }
    context.events.flushDeferred();
    system.update(DT, context);

    expect(progressionOf(context)?.restored).toEqual(['region.alpha', 'region.mid', 'region.zeta']);
  });
});

describe('persistence (AC1, FR-INV-005)', () => {
  it('progression is a persisted slice and round-trips across save/load', () => {
    expect(PROGRESSION_SLICES).toContain(PROGRESSION);

    const live = makeContext();
    const system = createProgressionSystem();
    system.init(live);
    spawnQuest(live, GRANTING_QUEST);
    live.events.publish(SYSTEM_RESTORED, { questId: 'quest.q', regionId: 'region.test-yard' });
    live.events.publish(QUEST_COMPLETED, { questId: 'quest.test-restoration' });
    live.events.flushDeferred();
    system.update(DT, live);

    const pack = { id: 'pack.reference', version: '0.1.0' };
    const envelope = captureSave(live.world, pack, [PROGRESSION]);

    // A fresh world: the resumed System adopts its own slice entity at the
    // same deterministic id, and the save overlays the recorded value.
    const resumed = makeContext();
    const resumedSystem = createProgressionSystem();
    resumedSystem.init(resumed);
    spawnQuest(resumed, GRANTING_QUEST);
    applySave(resumed.world, envelope, [PROGRESSION]);

    expect(progressionOf(resumed)).toEqual(progressionOf(live));
    expect(progressionOf(resumed)).toEqual({
      restored: ['region.test-yard'],
      quests: ['quest.test-restoration'],
      capabilities: ['capability.test-power'],
      items: ['item.test-key'],
    });
  });
});
