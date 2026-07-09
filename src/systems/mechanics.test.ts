/**
 * Mini-games catalog suite (issue #34): each of the three mechanic types is
 * playable start to success through input intents and completes a quest via
 * the host's result feed (AC1), each playthrough is shaped by params alone
 * (AC1, data-configurable), and every type offers the hold-to-bypass that
 * reveals meaning immediately (AC2, FR-VIS-010). Feedback beats
 * (progress/setback) announce every accepted and rejected action
 * (FR-MGC-006). Deterministic: input snapshots and dt only.
 */
import { describe, expect, it } from 'vitest';
import type { ComponentData, Plugin, System, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { InputIntent } from './input';
import { INPUT_INTENT } from './input';
import {
  ASSEMBLY_STATE,
  createAssemblyPlugin,
  createOrchestratePlugin,
  createRouteAndBalancePlugin,
  MECHANIC_ASSEMBLY,
  MECHANIC_ORCHESTRATE,
  MECHANIC_ROUTE_AND_BALANCE,
  MINIGAME_FEEDBACK,
  ORCHESTRATE_STATE,
  ROUTE_BALANCE_STATE,
} from './mechanics';
import {
  activeMinigameSession,
  createMinigameHostSystem,
  METAPHOR,
  MINIGAME_LAUNCH_REQUESTED,
} from './minigame';
import type { QuestDefinition } from './quest';
import {
  createQuestSystem,
  initialQuestState,
  QUEST,
  QUEST_COMPLETED,
  QUEST_REVEALED,
  QUEST_STATE,
} from './quest';

const DT = 1 / 60;

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

const IDLE_INTENT: InputIntent = { moveX: 0, moveY: 0, toX: null, toY: null, interact: false };

/** A booted little world: host + quest engine + one catalog mechanic. */
function makeWorld(
  plugin: Plugin,
  params: Readonly<Record<string, ComponentData>>,
  mechanicId: string,
) {
  const context: SystemContext = {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: true }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const quest = context.world.createEntity();
  context.world.addComponent(quest, QUEST, DEFINITION);
  context.world.addComponent(quest, QUEST_STATE, initialQuestState(DEFINITION));
  const metaphor = context.world.createEntity();
  context.world.addComponent(metaphor, METAPHOR, {
    metaphorId: 'metaphor.sample',
    mechanicId,
    params,
    framingKey: 'metaphor.sample.framing',
  });
  const intentEntity = context.world.createEntity();
  context.world.addComponent(intentEntity, INPUT_INTENT, IDLE_INTENT);

  const systems: System[] = [createMinigameHostSystem(), createQuestSystem(), ...plugin.systems];
  for (const system of systems) system.init(context);

  const setIntent = (changes: Partial<InputIntent>) => {
    context.world.addComponent(intentEntity, INPUT_INTENT, { ...IDLE_INTENT, ...changes });
  };
  const tick = (steps = 1) => {
    for (let i = 0; i < steps; i += 1) {
      context.events.flushDeferred();
      for (const system of systems) system.update(DT, context);
    }
  };
  /** One action press: down for a step, released for a step. */
  const press = (changes: Partial<InputIntent> = { interact: true }) => {
    setIntent(changes);
    tick();
    setIntent({});
    tick();
  };
  const start = () => {
    context.events.publish(MINIGAME_LAUNCH_REQUESTED, {
      questId: DEFINITION.questId,
      objectiveId: 'obj.one',
    });
    tick(2); // session opens, then the mechanic enters
    // Release the baseline hold so the first real press registers an edge.
    setIntent({});
    tick();
  };
  const questState = () => {
    const entity = context.world.query(QUEST_STATE)[0];
    return entity === undefined ? undefined : context.world.getComponent(entity, QUEST_STATE);
  };
  return { context, tick, setIntent, press, start, questState };
}

function record(context: SystemContext) {
  const feedback: { kind: string; ratio: number }[] = [];
  context.events.subscribe(MINIGAME_FEEDBACK, (event) =>
    feedback.push({ kind: event.payload.kind, ratio: event.payload.ratio }),
  );
  const completed: string[] = [];
  context.events.subscribe(QUEST_COMPLETED, (event) => completed.push(event.payload.questId));
  const revealed: string[] = [];
  context.events.subscribe(QUEST_REVEALED, (event) => revealed.push(event.payload.revealsKey));
  return { feedback, completed, revealed };
}

describe('route-and-balance (FR-MGC-002)', () => {
  it('routes a params-shaped load to success, rejecting overfilled channels', () => {
    const world = makeWorld(
      createRouteAndBalancePlugin(),
      { channels: [1, 2], load: 3 },
      MECHANIC_ROUTE_AND_BALANCE,
    );
    const events = record(world.context);
    world.start();

    world.press(); // one unit into channel 0 (capacity 1): progress 1/3
    world.press(); // channel 0 is full: setback
    world.press({ moveX: 1 }); // select channel 1
    world.press(); // progress 2/3
    world.press(); // progress 3/3 -> success
    world.tick(4); // resolution and completion flush through

    expect(events.feedback).toEqual([
      { kind: 'progress', ratio: 1 / 3 },
      { kind: 'setback', ratio: 1 / 3 },
      { kind: 'progress', ratio: 2 / 3 },
      { kind: 'progress', ratio: 1 },
    ]);
    expect(events.completed).toEqual([DEFINITION.questId]);
    expect(world.questState()).toEqual({
      status: 'completed',
      objectives: { 'obj.one': 'solved' },
    });
    expect(activeMinigameSession(world.context)).toBeNull();
    // The play slice is cleared on exit (FR-MGC-007).
    expect(world.context.world.query(ROUTE_BALANCE_STATE)).toHaveLength(0);
  });

  it('defaults keep the puzzle playable when params are absent (FR-MGC-008)', () => {
    const world = makeWorld(createRouteAndBalancePlugin(), {}, MECHANIC_ROUTE_AND_BALANCE);
    const events = record(world.context);
    world.start();
    // Defaults: channels [2, 2, 1], load 4 — fill the first two channels.
    world.press();
    world.press();
    world.press({ moveX: 1 });
    world.press();
    world.press();
    world.tick(4);
    expect(events.completed).toEqual([DEFINITION.questId]);
  });

  it('clamps an impossible load to total capacity so the puzzle stays solvable', () => {
    const world = makeWorld(
      createRouteAndBalancePlugin(),
      { channels: [1], load: 99 },
      MECHANIC_ROUTE_AND_BALANCE,
    );
    const events = record(world.context);
    world.start();
    world.press(); // the single unit the world can hold
    world.tick(4);
    expect(events.completed).toEqual([DEFINITION.questId]);
  });
});

describe('assembly (FR-MGC-003)', () => {
  it('places the params-declared sequence, rejecting wrong parts', () => {
    const world = makeWorld(
      createAssemblyPlugin(),
      { slots: [1, 0], choices: 3 },
      MECHANIC_ASSEMBLY,
    );
    const events = record(world.context);
    world.start();

    world.press(); // part 0 into a slot wanting 1: setback
    world.press({ moveY: 1 }); // cycle down to part 1
    world.press(); // correct: progress 1/2
    world.press({ moveY: -1 }); // cycle up back to part 0
    world.press(); // correct: progress 2/2 -> success
    world.tick(4);

    expect(events.feedback).toEqual([
      { kind: 'setback', ratio: 0 },
      { kind: 'progress', ratio: 1 / 2 },
      { kind: 'progress', ratio: 1 },
    ]);
    expect(events.completed).toEqual([DEFINITION.questId]);
    expect(world.questState()?.objectives).toEqual({ 'obj.one': 'solved' });
    expect(world.context.world.query(ASSEMBLY_STATE)).toHaveLength(0);
  });

  it('normalizes out-of-range slot indexes into the offered choices', () => {
    // Slot value 5 with 2 choices normalizes to part 1: still solvable.
    const world = makeWorld(createAssemblyPlugin(), { slots: [5], choices: 2 }, MECHANIC_ASSEMBLY);
    const events = record(world.context);
    world.start();
    world.press({ moveY: 1 }); // select part 1
    world.press();
    world.tick(4);
    expect(events.completed).toEqual([DEFINITION.questId]);
  });
});

describe('orchestrate (FR-MGC-004)', () => {
  it('activates every track inside its window to success', () => {
    const world = makeWorld(
      createOrchestratePlugin(),
      {
        tracks: [
          { periodSeconds: 2, windowSeconds: 0.5 },
          { periodSeconds: 3, windowSeconds: 0.5 },
        ],
      },
      MECHANIC_ORCHESTRATE,
    );
    const events = record(world.context);
    world.start();
    world.press(); // phases barely moved: track 1 window is open
    world.press(); // track 2 window still open -> success
    world.tick(4);
    expect(events.feedback).toEqual([
      { kind: 'progress', ratio: 1 / 2 },
      { kind: 'progress', ratio: 1 },
    ]);
    expect(events.completed).toEqual([DEFINITION.questId]);
    expect(world.context.world.query(ORCHESTRATE_STATE)).toHaveLength(0);
  });

  it('a press outside the window is a setback; the wrapped window accepts', () => {
    const world = makeWorld(
      createOrchestratePlugin(),
      { tracks: [{ periodSeconds: 2, windowSeconds: 0.2 }] },
      MECHANIC_ORCHESTRATE,
    );
    const events = record(world.context);
    world.start();
    world.tick(30); // ~0.5s in: the window has shut
    world.press();
    expect(events.feedback).toEqual([{ kind: 'setback', ratio: 0 }]);

    // Wait deterministically for the phase to wrap back into the window.
    const stateOf = () => {
      const entity = world.context.world.query(ORCHESTRATE_STATE)[0];
      return entity === undefined
        ? undefined
        : world.context.world.getComponent(entity, ORCHESTRATE_STATE);
    };
    let guard = 0;
    while ((stateOf()?.tracks[0]?.phase ?? 1) >= 0.15 && guard < 300) {
      world.tick();
      guard += 1;
    }
    world.press();
    world.tick(4);
    expect(events.completed).toEqual([DEFINITION.questId]);
  });
});

describe('the uniform bypass (AC2, FR-VIS-010, FR-MGC-005)', () => {
  const catalog: readonly [string, () => Plugin, Readonly<Record<string, ComponentData>>][] = [
    [MECHANIC_ROUTE_AND_BALANCE, createRouteAndBalancePlugin, {}],
    [MECHANIC_ASSEMBLY, createAssemblyPlugin, {}],
    [MECHANIC_ORCHESTRATE, createOrchestratePlugin, {}],
  ];

  it.each(catalog)(
    '%s resolves bypass after the held span and reveals meaning',
    (id, make, params) => {
      const world = makeWorld(make(), params, id);
      const events = record(world.context);
      world.start();
      world.setIntent({ interact: true });
      world.tick(Math.ceil(3 / DT) + 1); // hold through the default 3s span
      world.tick(4); // resolution flushes through
      expect(world.questState()?.objectives).toEqual({ 'obj.one': 'bypassed' });
      expect(events.revealed).toContain(DEFINITION.bypassRevealsKey);
      expect(activeMinigameSession(world.context)).toBeNull();
    },
  );

  it('releasing interact resets the hold; params tune the span', () => {
    const world = makeWorld(
      createRouteAndBalancePlugin(),
      { bypassHoldSeconds: 0.5 },
      MECHANIC_ROUTE_AND_BALANCE,
    );
    const events = record(world.context);
    world.start();
    // Hold just short of the tuned span, release, hold short again: no bypass.
    world.setIntent({ interact: true });
    world.tick(25);
    world.setIntent({});
    world.tick(1);
    world.setIntent({ interact: true });
    world.tick(25);
    expect(world.questState()?.objectives).toEqual({ 'obj.one': 'pending' });
    // Now hold through the tuned span: bypass.
    world.tick(10);
    world.tick(4);
    expect(world.questState()?.objectives).toEqual({ 'obj.one': 'bypassed' });
    expect(events.revealed).toContain(DEFINITION.bypassRevealsKey);
  });
});
