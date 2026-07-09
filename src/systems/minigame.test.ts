/**
 * Mini-Games host framework suite (issue #33): a sample mechanic-type
 * plugin registers and runs, returning a result event a quest consumes
 * end to end (AC1); mechanic plugins hard-depend on the host
 * (FR-ARCH-020); the bypass outcome reveals meaning immediately
 * (FR-VIS-010); and launches or resolutions that match nothing degrade
 * silently (FR-ARCH-008). All deterministic and event-driven — no wall
 * clock, no unseeded randomness.
 */
import { describe, expect, it } from 'vitest';
import type { EventPayload, EventType, System, SystemContext } from '../core';
import {
  deepFreeze,
  EntityStore,
  EventBus,
  ModuleRegistry,
  RngService,
  TimeService,
} from '../core';
import type { MechanicOutcome, MechanicSpec, MinigameSession } from './minigame';
import {
  activeMinigameSession,
  createMechanicPlugin,
  createMechanicSystem,
  createMinigameHostPlugin,
  createMinigameHostSystem,
  MECHANIC_TYPE,
  METAPHOR,
  MINIGAME_ENDED,
  MINIGAME_LAUNCH_REQUESTED,
  MINIGAME_RESOLVED,
  MINIGAME_SESSION,
  MINIGAME_STARTED,
} from './minigame';
import type { QuestDefinition } from './quest';
import {
  createQuestSystem,
  initialQuestState,
  OBJECTIVE_RESOLVED,
  QUEST,
  QUEST_COMPLETED,
  QUEST_REVEALED,
  QUEST_STATE,
} from './quest';

const DT = 1 / 60;
const MECHANIC_ID = 'engine.mechanic.sample';

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
  metaphorRef: 'metaphor.sample',
  objectives: [{ id: 'obj.one', descriptionKey: 'quest.sample.obj.one' }],
  emitsOnComplete: [],
  revealsKey: 'quest.sample.reveal',
  bypassAllowed: true,
  bypassRevealsKey: 'quest.sample.reveal.bypass',
};

function spawnQuest(context: SystemContext, overrides: Partial<QuestDefinition> = {}): void {
  const definition = { ...DEFINITION, ...overrides };
  const quest = context.world.createEntity();
  context.world.addComponent(quest, QUEST, definition);
  context.world.addComponent(quest, QUEST_STATE, initialQuestState(definition));
}

function spawnMetaphor(
  context: SystemContext,
  overrides: Partial<{ metaphorId: string; mechanicId: string }> = {},
): void {
  const metaphor = context.world.createEntity();
  context.world.addComponent(metaphor, METAPHOR, {
    metaphorId: 'metaphor.sample',
    mechanicId: MECHANIC_ID,
    params: { stepsToSolve: 2 },
    framingKey: 'metaphor.sample.framing',
    ...overrides,
  });
}

/** A sample mechanic: plays for `params.stepsToSolve` steps, then resolves. */
function sampleSpec(outcome: MechanicOutcome = 'success') {
  const calls = {
    entered: [] as MinigameSession[],
    played: 0,
    exited: [] as { session: MinigameSession; outcome: MechanicOutcome }[],
  };
  const spec: MechanicSpec = {
    mechanicId: MECHANIC_ID,
    enter: (session) => calls.entered.push(session),
    play: (_dt, session) => {
      calls.played += 1;
      const target =
        typeof session.params['stepsToSolve'] === 'number' ? session.params['stepsToSolve'] : 1;
      return calls.played >= target ? outcome : null;
    },
    exit: (result) => calls.exited.push(result),
  };
  return { spec, calls };
}

/** Init the given Systems and return a per-tick driver (flush, then update). */
function boot(context: SystemContext, systems: readonly System[]) {
  for (const system of systems) system.init(context);
  return () => {
    context.events.flushDeferred();
    for (const system of systems) system.update(DT, context);
  };
}

function recorder<T extends EventPayload>(context: SystemContext, type: EventType<T>): T[] {
  const seen: T[] = [];
  context.events.subscribe(type, (event) => seen.push(event.payload));
  return seen;
}

function launch(context: SystemContext, questId = DEFINITION.questId, objectiveId = 'obj.one') {
  context.events.publish(MINIGAME_LAUNCH_REQUESTED, { questId, objectiveId });
}

function questState(context: SystemContext) {
  const entity = context.world.query(QUEST_STATE)[0];
  return entity === undefined ? undefined : context.world.getComponent(entity, QUEST_STATE);
}

describe('registration (FR-ARCH-017..020)', () => {
  it('the host plugin and a mechanic plugin register as units and order resolves', () => {
    const registry = new ModuleRegistry();
    registry.register(createMinigameHostPlugin());
    registry.register(createMechanicPlugin(sampleSpec().spec));
    expect(registry.order.map((system) => system.id)).toEqual(['minigame-host', MECHANIC_ID]);
    expect(registry.eventTypes.has('minigame.launch')).toBe(true);
    expect(registry.componentTypes.has('minigame-session')).toBe(true);
  });

  it('a mechanic plugin without the host fails loudly (FR-ARCH-020)', () => {
    const registry = new ModuleRegistry();
    registry.register(createMechanicPlugin(sampleSpec().spec));
    expect(() => registry.order).toThrow(/plugin\.minigame-host/);
  });

  it('a mechanic System registers its descriptor at init and retracts it at teardown', () => {
    const context = makeContext();
    const system = createMechanicSystem(sampleSpec().spec);
    system.init(context);
    const registered = () =>
      context.world
        .query(MECHANIC_TYPE)
        .map((entity) => context.world.getComponent(entity, MECHANIC_TYPE)?.mechanicId);
    expect(registered()).toEqual([MECHANIC_ID]);
    system.teardown(context);
    expect(registered()).toEqual([]);
  });
});

describe('a sample mechanic plays a quest objective end to end (AC1)', () => {
  it('launch -> enter -> play -> success resolves the objective and completes the quest', () => {
    const context = makeContext();
    const { spec, calls } = sampleSpec('success');
    spawnQuest(context);
    spawnMetaphor(context);
    const tick = boot(context, [
      createMinigameHostSystem(),
      createQuestSystem(),
      createMechanicSystem(spec),
    ]);
    const started = recorder(context, MINIGAME_STARTED);
    const resolved = recorder(context, OBJECTIVE_RESOLVED);
    const completed = recorder(context, QUEST_COMPLETED);
    const ended = recorder(context, MINIGAME_ENDED);

    launch(context);
    for (let step = 0; step < 6; step += 1) tick();

    expect(started).toEqual([
      {
        mechanicId: MECHANIC_ID,
        metaphorId: 'metaphor.sample',
        questId: DEFINITION.questId,
        objectiveId: 'obj.one',
        framingKey: 'metaphor.sample.framing',
      },
    ]);
    // The mechanic entered once with the session view, params included.
    expect(calls.entered).toHaveLength(1);
    expect(calls.entered[0]?.params).toEqual({ stepsToSolve: 2 });
    // Content configured the play length: two steps, then resolution.
    expect(calls.played).toBe(2);
    expect(resolved).toEqual([
      { questId: DEFINITION.questId, objectiveId: 'obj.one', outcome: 'solved' },
    ]);
    expect(completed).toEqual([{ questId: DEFINITION.questId }]);
    expect(ended).toEqual([
      {
        mechanicId: MECHANIC_ID,
        questId: DEFINITION.questId,
        objectiveId: 'obj.one',
        outcome: 'success',
      },
    ]);
    expect(calls.exited).toEqual([{ session: calls.entered[0], outcome: 'success' }]);
    // The session closed and the quest settled.
    expect(activeMinigameSession(context)).toBeNull();
    expect(questState(context)).toEqual({
      status: 'completed',
      objectives: { 'obj.one': 'solved' },
    });
  });

  it('a bypass outcome forwards `bypassed` and the quest reveals immediately (FR-VIS-010)', () => {
    const context = makeContext();
    const { spec } = sampleSpec('bypass');
    spawnQuest(context, {
      objectives: [
        { id: 'obj.one', descriptionKey: 'quest.sample.obj.one' },
        { id: 'obj.two', descriptionKey: 'quest.sample.obj.two' },
      ],
    });
    spawnMetaphor(context);
    const tick = boot(context, [
      createMinigameHostSystem(),
      createQuestSystem(),
      createMechanicSystem(spec),
    ]);
    const revealed = recorder(context, QUEST_REVEALED);

    launch(context);
    for (let step = 0; step < 6; step += 1) tick();

    // The quest is still mid-arc, yet the meaning is already revealed.
    expect(questState(context)).toEqual({
      status: 'active',
      objectives: { 'obj.one': 'bypassed', 'obj.two': 'pending' },
    });
    expect(revealed).toEqual([
      { questId: DEFINITION.questId, revealsKey: 'quest.sample.reveal.bypass' },
    ]);
  });
});

describe('launches that match nothing degrade silently (FR-ARCH-008)', () => {
  function bootHostAndMechanic(context: SystemContext) {
    const { spec } = sampleSpec();
    return boot(context, [
      createMinigameHostSystem(),
      createQuestSystem(),
      createMechanicSystem(spec),
    ]);
  }

  it('an unknown quest id or objective id opens nothing', () => {
    for (const [questId, objectiveId] of [
      ['quest.unknown', 'obj.one'],
      [DEFINITION.questId, 'obj.unknown'],
    ] as const) {
      const context = makeContext();
      spawnQuest(context);
      spawnMetaphor(context);
      const tick = bootHostAndMechanic(context);
      const started = recorder(context, MINIGAME_STARTED);
      launch(context, questId, objectiveId);
      tick();
      tick();
      expect(started).toEqual([]);
      expect(activeMinigameSession(context)).toBeNull();
    }
  });

  it('a quest with no metaphor binding, a missing binding, or an unregistered mechanic opens nothing', () => {
    for (const shape of ['no-ref', 'dangling-ref', 'unregistered'] as const) {
      const context = makeContext();
      spawnQuest(context, { metaphorRef: shape === 'no-ref' ? null : 'metaphor.sample' });
      if (shape !== 'dangling-ref') {
        spawnMetaphor(context, {
          mechanicId: shape === 'unregistered' ? 'engine.mechanic.absent' : MECHANIC_ID,
        });
      }
      const tick = bootHostAndMechanic(context);
      const started = recorder(context, MINIGAME_STARTED);
      launch(context);
      tick();
      expect(started).toEqual([]);
    }
  });

  it('one session at a time: a second launch while one is active is ignored', () => {
    const context = makeContext();
    const other: QuestDefinition = { ...DEFINITION, questId: 'quest.other' };
    spawnQuest(context, { objectives: DEFINITION.objectives });
    spawnQuest(context, other);
    spawnMetaphor(context);
    // A mechanic that never resolves keeps the first session open.
    const tick = boot(context, [
      createMinigameHostSystem(),
      createQuestSystem(),
      createMechanicSystem({ mechanicId: MECHANIC_ID, play: () => null }),
    ]);
    const started = recorder(context, MINIGAME_STARTED);
    launch(context);
    tick();
    launch(context, 'quest.other');
    tick();
    tick();
    expect(started.map((event) => event.questId)).toEqual([DEFINITION.questId]);
    expect(activeMinigameSession(context)?.questId).toBe(DEFINITION.questId);
  });

  it('a launch for a settled objective is ignored; a stray or duplicate resolution changes nothing', () => {
    const context = makeContext();
    const { spec } = sampleSpec();
    spawnQuest(context);
    spawnMetaphor(context);
    const tick = boot(context, [
      createMinigameHostSystem(),
      createQuestSystem(),
      createMechanicSystem(spec),
    ]);
    const forwarded = recorder(context, OBJECTIVE_RESOLVED);

    // A resolution with no session open: nothing forwards.
    context.events.publish(MINIGAME_RESOLVED, {
      questId: DEFINITION.questId,
      objectiveId: 'obj.one',
      outcome: 'success',
    });
    tick();
    expect(forwarded).toEqual([]);

    // Play the objective to completion, then try to launch and resolve again.
    launch(context);
    for (let step = 0; step < 6; step += 1) tick();
    expect(forwarded).toHaveLength(1);
    launch(context);
    context.events.publish(MINIGAME_RESOLVED, {
      questId: DEFINITION.questId,
      objectiveId: 'obj.one',
      outcome: 'success',
    });
    for (let step = 0; step < 3; step += 1) tick();
    expect(forwarded).toHaveLength(1);
    expect(activeMinigameSession(context)).toBeNull();
  });

  it('a resolution for a different objective than the active session is ignored', () => {
    const context = makeContext();
    spawnQuest(context, {
      objectives: [
        { id: 'obj.one', descriptionKey: 'quest.sample.obj.one' },
        { id: 'obj.two', descriptionKey: 'quest.sample.obj.two' },
      ],
    });
    spawnMetaphor(context);
    const tick = boot(context, [
      createMinigameHostSystem(),
      createQuestSystem(),
      createMechanicSystem({ mechanicId: MECHANIC_ID, play: () => null }),
    ]);
    const forwarded = recorder(context, OBJECTIVE_RESOLVED);
    launch(context);
    tick();
    context.events.publish(MINIGAME_RESOLVED, {
      questId: DEFINITION.questId,
      objectiveId: 'obj.two',
      outcome: 'success',
    });
    tick();
    expect(forwarded).toEqual([]);
    expect(activeMinigameSession(context)?.objectiveId).toBe('obj.one');
  });
});

describe('lifecycle hygiene (hot-reload, FR-ARCH-005)', () => {
  it('after host teardown a launch does nothing; re-init reuses the session slice', () => {
    const context = makeContext();
    spawnQuest(context);
    spawnMetaphor(context);
    const host = createMinigameHostSystem();
    const mechanic = createMechanicSystem({ mechanicId: MECHANIC_ID, play: () => null });
    host.init(context);
    mechanic.init(context);
    host.teardown(context);
    launch(context);
    context.events.flushDeferred();
    expect(activeMinigameSession(context)).toBeNull();
    host.init(context);
    expect(context.world.query(MINIGAME_SESSION)).toHaveLength(1);
    launch(context);
    context.events.flushDeferred();
    expect(activeMinigameSession(context)?.questId).toBe(DEFINITION.questId);
  });

  it('a torn-down mechanic no longer serves launches (its descriptor is gone)', () => {
    const context = makeContext();
    spawnQuest(context);
    spawnMetaphor(context);
    const host = createMinigameHostSystem();
    const mechanic = createMechanicSystem({ mechanicId: MECHANIC_ID, play: () => null });
    host.init(context);
    mechanic.init(context);
    mechanic.teardown(context);
    const started = recorder(context, MINIGAME_STARTED);
    launch(context);
    context.events.flushDeferred();
    expect(started).toEqual([]);
    expect(activeMinigameSession(context)).toBeNull();
  });
});
