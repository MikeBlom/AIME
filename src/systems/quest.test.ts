/**
 * Quest Engine suite (issue #25): content-driven quest completion flips the
 * region online and emits SystemRestored (AC1), the bypass path reveals the
 * career meaning without solving (AC2, FR-VIS-010), and quest progress
 * survives save/load (AC3) — all deterministic, event-driven, and tolerant
 * of unknown ids (FR-ARCH-008).
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { QuestDefinition } from './quest';
import {
  createQuestSystem,
  initialQuestState,
  OBJECTIVE_RESOLVED,
  QUEST,
  QUEST_ADVANCED,
  QUEST_COMPLETED,
  QUEST_REVEALED,
  QUEST_STATE,
  REGION_ONLINE,
  REGION_STATE_CHANGED,
  SYSTEM_RESTORED,
} from './quest';
import { applySave, captureSave } from './saveload';
import { REGION } from './scene';

const DT = 1 / 60;
const PACK = { id: 'pack.test', version: '1.0.0' };

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

const DEFINITION: QuestDefinition = {
  questId: 'quest.sample',
  titleKey: 'quest.sample.title',
  regionRef: 'region.sample',
  objectives: [{ id: 'obj.one', descriptionKey: 'quest.sample.obj.one' }],
  emitsOnComplete: ['SystemRestored'],
  revealsKey: 'quest.sample.reveal',
  bypassAllowed: true,
  bypassRevealsKey: 'quest.sample.reveal.bypass',
};

function spawnQuest(context: SystemContext, overrides: Partial<QuestDefinition> = {}): EntityId {
  const definition = { ...DEFINITION, ...overrides };
  const quest = context.world.createEntity();
  context.world.addComponent(quest, QUEST, definition);
  context.world.addComponent(quest, QUEST_STATE, initialQuestState(definition));
  return quest;
}

function spawnRegion(context: SystemContext, contentId = 'region.sample'): EntityId {
  const region = context.world.createEntity();
  context.world.addComponent(region, REGION, { contentId, state: 'offline' });
  return region;
}

/** Boot the System's subscriptions the way the registry's initAll would. */
function initQuest(context: SystemContext) {
  const system = createQuestSystem();
  system.init(context);
  return system;
}

function resolve(
  context: SystemContext,
  objectiveId: string,
  outcome: 'solved' | 'bypassed' = 'solved',
  questId = DEFINITION.questId,
) {
  context.events.publish(OBJECTIVE_RESOLVED, { questId, objectiveId, outcome });
  // First flush delivers the resolution to the quest System; the second
  // delivers what the quest System published (deferred, FR-ARCH-012).
  context.events.flushDeferred();
  context.events.flushDeferred();
}

describe('completion (AC1: region online + SystemRestored)', () => {
  it('completes on its last objective, flips the region online, and announces it', () => {
    const context = makeContext();
    const region = spawnRegion(context);
    const quest = spawnQuest(context);
    initQuest(context);
    const restored: (readonly [string, string])[] = [];
    const completed: string[] = [];
    const stateChanges: (readonly [string, string])[] = [];
    context.events.subscribe(SYSTEM_RESTORED, (event) =>
      restored.push([event.payload.questId, event.payload.regionId]),
    );
    context.events.subscribe(QUEST_COMPLETED, (event) => completed.push(event.payload.questId));
    context.events.subscribe(REGION_STATE_CHANGED, (event) =>
      stateChanges.push([event.payload.regionId, event.payload.state]),
    );

    resolve(context, 'obj.one');

    expect(context.world.getComponent(quest, QUEST_STATE)).toEqual({
      status: 'completed',
      objectives: { 'obj.one': 'solved' },
    });
    expect(context.world.getComponent(region, REGION)).toEqual({
      contentId: 'region.sample',
      state: REGION_ONLINE,
    });
    expect(completed).toEqual(['quest.sample']);
    expect(restored).toEqual([['quest.sample', 'region.sample']]);
    expect(stateChanges).toEqual([['region.sample', REGION_ONLINE]]);
  });

  it('stays active until every objective is resolved', () => {
    const context = makeContext();
    const region = spawnRegion(context);
    const quest = spawnQuest(context, {
      objectives: [
        { id: 'obj.a', descriptionKey: 'quest.sample.obj.a' },
        { id: 'obj.b', descriptionKey: 'quest.sample.obj.b' },
      ],
    });
    initQuest(context);

    resolve(context, 'obj.a');
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('active');
    expect(context.world.getComponent(region, REGION)?.state).toBe('offline');

    resolve(context, 'obj.b');
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('completed');
    expect(context.world.getComponent(region, REGION)?.state).toBe(REGION_ONLINE);
  });

  it('reveals the completion meaning as a locale key', () => {
    const context = makeContext();
    spawnRegion(context);
    spawnQuest(context);
    initQuest(context);
    const revealed: string[] = [];
    context.events.subscribe(QUEST_REVEALED, (event) => revealed.push(event.payload.revealsKey));

    resolve(context, 'obj.one');
    expect(revealed).toEqual(['quest.sample.reveal']);
  });

  it('announces each advance with its outcome', () => {
    const context = makeContext();
    spawnRegion(context);
    spawnQuest(context);
    initQuest(context);
    const advanced: (readonly [string, string])[] = [];
    context.events.subscribe(QUEST_ADVANCED, (event) =>
      advanced.push([event.payload.objectiveId, event.payload.outcome]),
    );
    resolve(context, 'obj.one');
    expect(advanced).toEqual([['obj.one', 'solved']]);
  });

  it('completes even when content declares unknown completion vocabulary', () => {
    const context = makeContext();
    const region = spawnRegion(context);
    const quest = spawnQuest(context, { emitsOnComplete: ['SomethingFutureShaped'] });
    initQuest(context);
    expect(() => resolve(context, 'obj.one')).not.toThrow();
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('completed');
    expect(context.world.getComponent(region, REGION)?.state).toBe(REGION_ONLINE);
  });

  it('completes without a spawned region entity, still announcing restoration', () => {
    const context = makeContext();
    const quest = spawnQuest(context); // no region entity in this world
    initQuest(context);
    const restored: string[] = [];
    context.events.subscribe(SYSTEM_RESTORED, (event) => restored.push(event.payload.regionId));
    expect(() => resolve(context, 'obj.one')).not.toThrow();
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('completed');
    expect(restored).toEqual(['region.sample']);
  });
});

describe('bypass path (AC2: FR-VIS-010, comprehension never gated)', () => {
  it('reveals the meaning immediately on bypass, before the quest completes', () => {
    const context = makeContext();
    spawnRegion(context);
    const quest = spawnQuest(context, {
      objectives: [
        { id: 'obj.a', descriptionKey: 'quest.sample.obj.a' },
        { id: 'obj.b', descriptionKey: 'quest.sample.obj.b' },
      ],
    });
    initQuest(context);
    const revealed: string[] = [];
    context.events.subscribe(QUEST_REVEALED, (event) => revealed.push(event.payload.revealsKey));

    resolve(context, 'obj.a', 'bypassed');
    expect(revealed).toEqual(['quest.sample.reveal.bypass']); // meaning lands NOW
    expect(context.world.getComponent(quest, QUEST_STATE)).toEqual({
      status: 'active',
      objectives: { 'obj.a': 'bypassed', 'obj.b': 'pending' },
    });
  });

  it('a fully bypassed quest still completes and restores its region', () => {
    const context = makeContext();
    const region = spawnRegion(context);
    const quest = spawnQuest(context);
    initQuest(context);
    const restored: string[] = [];
    context.events.subscribe(SYSTEM_RESTORED, (event) => restored.push(event.payload.questId));

    resolve(context, 'obj.one', 'bypassed');
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('completed');
    expect(context.world.getComponent(region, REGION)?.state).toBe(REGION_ONLINE);
    expect(restored).toEqual(['quest.sample']);
  });

  it('ignores a bypass the quest content forbids', () => {
    const context = makeContext();
    spawnRegion(context);
    const quest = spawnQuest(context, { bypassAllowed: false });
    initQuest(context);
    const revealed: string[] = [];
    context.events.subscribe(QUEST_REVEALED, (event) => revealed.push(event.payload.revealsKey));

    resolve(context, 'obj.one', 'bypassed');
    expect(context.world.getComponent(quest, QUEST_STATE)).toEqual({
      status: 'active',
      objectives: { 'obj.one': 'pending' },
    });
    expect(revealed).toEqual([]);
  });
});

describe('robustness (FR-ARCH-008) and idempotence', () => {
  it('ignores unknown quests and unknown objectives without faulting', () => {
    const context = makeContext();
    spawnRegion(context);
    const quest = spawnQuest(context);
    initQuest(context);
    expect(() => {
      resolve(context, 'obj.one', 'solved', 'quest.unknown');
      resolve(context, 'obj.unknown');
    }).not.toThrow();
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('active');
  });

  it('an objective resolves once; a completed quest is settled', () => {
    const context = makeContext();
    spawnRegion(context);
    spawnQuest(context);
    initQuest(context);
    const completed: string[] = [];
    const advanced: string[] = [];
    context.events.subscribe(QUEST_COMPLETED, (event) => completed.push(event.payload.questId));
    context.events.subscribe(QUEST_ADVANCED, (event) => advanced.push(event.payload.objectiveId));

    resolve(context, 'obj.one');
    resolve(context, 'obj.one'); // replay of the same resolution
    expect(advanced).toEqual(['obj.one']);
    expect(completed).toEqual(['quest.sample']);
  });

  it('stops reacting after teardown (clean re-init, hot-reload safe)', () => {
    const context = makeContext();
    spawnRegion(context);
    const quest = spawnQuest(context);
    const system = initQuest(context);
    system.teardown(context);
    resolve(context, 'obj.one');
    expect(context.world.getComponent(quest, QUEST_STATE)?.status).toBe('active');
  });
});

describe('persistence (AC3: progress survives save/load)', () => {
  it('round-trips mid-progress and completed quest state through the save envelope', () => {
    // World A: play to mid-progress.
    const a = makeContext();
    spawnRegion(a);
    const questA = spawnQuest(a, {
      objectives: [
        { id: 'obj.a', descriptionKey: 'quest.sample.obj.a' },
        { id: 'obj.b', descriptionKey: 'quest.sample.obj.b' },
      ],
    });
    initQuest(a);
    resolve(a, 'obj.a');
    const envelope = captureSave(a.world, PACK);
    expect(envelope.slices[QUEST_STATE.id]).toEqual([
      [questA, { status: 'active', objectives: { 'obj.a': 'solved', 'obj.b': 'pending' } }],
    ]);

    // World B: the same deterministic spawn, resumed from the envelope.
    const b = makeContext();
    spawnRegion(b);
    const questB = spawnQuest(b, {
      objectives: [
        { id: 'obj.a', descriptionKey: 'quest.sample.obj.a' },
        { id: 'obj.b', descriptionKey: 'quest.sample.obj.b' },
      ],
    });
    initQuest(b);
    applySave(b.world, envelope);
    expect(b.world.getComponent(questB, QUEST_STATE)).toEqual({
      status: 'active',
      objectives: { 'obj.a': 'solved', 'obj.b': 'pending' },
    });

    // The resumed world continues exactly where it left off.
    resolve(b, 'obj.b');
    expect(b.world.getComponent(questB, QUEST_STATE)?.status).toBe('completed');
  });
});

describe('determinism (NFR-ARCH-001)', () => {
  it('identical resolution scripts reproduce identical state and event sequences', () => {
    const run = () => {
      const context = makeContext();
      spawnRegion(context);
      const quest = spawnQuest(context, {
        objectives: [
          { id: 'obj.a', descriptionKey: 'quest.sample.obj.a' },
          { id: 'obj.b', descriptionKey: 'quest.sample.obj.b' },
        ],
      });
      initQuest(context);
      resolve(context, 'obj.b', 'bypassed');
      resolve(context, 'obj.a');
      return {
        state: context.world.getComponent(quest, QUEST_STATE),
        log: context.events.eventLog.map((entry) => [entry.kind, entry.type]),
      };
    };
    expect(run()).toEqual(run());
  });
});
