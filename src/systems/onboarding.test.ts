/**
 * Onboarding System suite (issue #44): the first-minute guidance arc lands
 * every applicable beat inside sixty simulated seconds and never blocks
 * (AC1: delight budget, never lost), no cue is modal and none stomps
 * another System's hint (AC2: no modal tutorial, no text wall), each
 * demonstrated skill cancels its nudge, one-shot beats persist across a
 * save round-trip, and the whole arc replays deterministically.
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { INTENT_INTERACT } from './input';
import {
  ADRIFT_SECONDS,
  createOnboardingSystem,
  CUE_SECONDS,
  FRESH_ONBOARDING,
  INTERACT_NUDGE_SECONDS,
  MOVE_NUDGE_SECONDS,
  ONBOARDING_CUE,
  ONBOARDING_INTERACT_KEY,
  ONBOARDING_MOVE_KEY,
  ONBOARDING_OBJECTIVE_KEY,
  ONBOARDING_STATE,
  ONBOARDING_WELCOME_KEY,
  WELCOME_DELAY_SECONDS,
} from './onboarding';
import { initialQuestState, QUEST_STATE } from './quest';
import { MOVEMENT_STARTED } from './scene';
import { IDLE_UI_STATE, UI_HINT, UI_STATE } from './ui';

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

function spawnOpenQuest(context: SystemContext): void {
  const quest = context.world.createEntity();
  context.world.addComponent(
    quest,
    QUEST_STATE,
    initialQuestState({
      questId: 'quest.q1',
      titleKey: 'quest.q1.title',
      regionRef: 'region.r1',
      objectives: [{ id: 'o1', descriptionKey: 'quest.q1.o1' }],
      emitsOnComplete: [],
      revealsKey: null,
      bypassAllowed: false,
      bypassRevealsKey: null,
    }),
  );
}

type HintAt = { key: string | null; second: number };
type CueAt = { cueId: string; textKey: string; second: number };

/**
 * Drive the system for `seconds`, applying scripted events at their
 * simulation second, and capture the hint-line and cue feeds with timing.
 */
function run(
  context: SystemContext,
  seconds: number,
  script: readonly { at: number; fire: (context: SystemContext) => void }[] = [],
) {
  const hints: HintAt[] = [];
  const cues: CueAt[] = [];
  let step = 0;
  context.events.subscribe(UI_HINT, (event) => {
    hints.push({ key: event.payload.textKey, second: step * DT });
  });
  context.events.subscribe(ONBOARDING_CUE, (event) => {
    cues.push({ ...event.payload, second: step * DT });
  });
  const system = createOnboardingSystem();
  system.init(context);
  const steps = Math.ceil(seconds / DT);
  const pending = [...script];
  for (step = 0; step < steps; step += 1) {
    while (pending.length > 0 && pending[0] !== undefined && pending[0].at <= step * DT) {
      pending.shift()?.fire(context);
    }
    system.update(DT, context);
    context.events.flushDeferred();
  }
  return { hints, cues, system };
}

describe('the first-minute arc (NFR-VIS-006, FR-VIS-009)', () => {
  it('walks a fully passive session through welcome, move, and objective inside a minute', () => {
    const context = makeContext();
    spawnOpenQuest(context);
    const { cues } = run(context, 60);

    expect(cues.map((cue) => cue.cueId)).toEqual(['welcome', 'move', 'objective']);
    const [welcome, move, objective] = cues;
    expect(welcome?.textKey).toBe(ONBOARDING_WELCOME_KEY);
    expect(welcome?.second).toBeGreaterThanOrEqual(WELCOME_DELAY_SECONDS - DT);
    expect(welcome?.second).toBeLessThanOrEqual(WELCOME_DELAY_SECONDS + 2 * DT);
    expect(move?.textKey).toBe(ONBOARDING_MOVE_KEY);
    expect(move?.second).toBeLessThanOrEqual(MOVE_NUDGE_SECONDS + 2 * DT);
    expect(objective?.textKey).toBe(ONBOARDING_OBJECTIVE_KEY);
    expect(objective?.second).toBeLessThan(60);
  });

  it('clears every cue from the hint line after its ride (no text wall)', () => {
    const context = makeContext();
    const { hints } = run(context, 20);

    // welcome set → cleared → move nudge set → cleared: strict alternation.
    expect(hints.map((hint) => hint.key)).toEqual([
      ONBOARDING_WELCOME_KEY,
      null,
      ONBOARDING_MOVE_KEY,
      null,
    ]);
    const [shown, cleared] = hints;
    expect((cleared?.second ?? 0) - (shown?.second ?? 0)).toBeCloseTo(CUE_SECONDS, 1);
  });

  it('replays identically: same script, same cue feed (FR-ARCH-025)', () => {
    const script = [
      { at: 3, fire: (c: SystemContext) => c.events.publish(MOVEMENT_STARTED, { entityId: 1 }) },
      { at: 21, fire: (c: SystemContext) => c.events.publish(INTENT_INTERACT, {}) },
    ];
    const pass = () => {
      const context = makeContext();
      spawnOpenQuest(context);
      return run(context, 90, script);
    };
    const first = pass();
    expect(first.cues.length).toBeGreaterThan(0);
    expect(pass().cues).toEqual(first.cues);
    expect(pass().hints).toEqual(first.hints);
  });
});

describe('teaching by consequence: skills cancel their nudges', () => {
  it('never nudges movement once the player has moved', () => {
    const context = makeContext();
    const { cues } = run(context, 30, [
      { at: 3, fire: (c) => c.events.publish(MOVEMENT_STARTED, { entityId: 1 }) },
      { at: 20, fire: (c) => c.events.publish(INTENT_INTERACT, {}) },
    ]);
    expect(cues.map((cue) => cue.cueId)).not.toContain('move');
  });

  it('nudges interaction only after movement, and interacting cancels it early', () => {
    const context = makeContext();
    const { cues, hints } = run(context, 30, [
      { at: 2, fire: (c) => c.events.publish(MOVEMENT_STARTED, { entityId: 1 }) },
      {
        at: 2 + INTERACT_NUDGE_SECONDS + 1,
        fire: (c) => c.events.publish(INTENT_INTERACT, {}),
      },
    ]);
    const interact = cues.find((cue) => cue.cueId === 'interact');
    expect(interact).toBeDefined();
    expect(interact?.second).toBeGreaterThanOrEqual(2 + INTERACT_NUDGE_SECONDS - 2 * DT);
    // The cancel lands within a step of the interaction, well before the ride ends.
    const shownAt = hints.find((hint) => hint.key === ONBOARDING_INTERACT_KEY)?.second ?? 0;
    const clearedAt = hints.find((hint) => hint.key === null && hint.second > shownAt)?.second;
    expect(clearedAt).toBeDefined();
    expect((clearedAt ?? 0) - shownAt).toBeLessThan(CUE_SECONDS);
  });

  it('re-orients an adrift player only while a quest is open, and re-arms', () => {
    const withQuest = makeContext();
    spawnOpenQuest(withQuest);
    const { cues } = run(withQuest, ADRIFT_SECONDS * 2 + 30);
    const objectives = cues.filter((cue) => cue.cueId === 'objective');
    expect(objectives.length).toBeGreaterThanOrEqual(2); // never lost: it re-arms

    const noQuest = makeContext();
    const quiet = run(noQuest, ADRIFT_SECONDS + 30);
    expect(quiet.cues.map((cue) => cue.cueId)).not.toContain('objective');
  });
});

describe('politeness: never modal, never stomping (FR-ARCH-005/008)', () => {
  it('holds every cue while a modal surface is open', () => {
    const context = makeContext();
    const ui = context.world.createEntity();
    context.world.addComponent(ui, UI_STATE, { ...IDLE_UI_STATE, modal: true });
    const { cues } = run(context, 10);
    expect(cues).toEqual([]);
  });

  it("waits out another System's hint instead of replacing it", () => {
    const context = makeContext();
    const ui = context.world.createEntity();
    context.world.addComponent(ui, UI_STATE, { ...IDLE_UI_STATE, hint: 'achievement.title' });
    const { cues } = run(context, 10, [
      {
        at: 6,
        fire: (c) => c.world.addComponent(ui, UI_STATE, IDLE_UI_STATE),
      },
    ]);
    expect(cues.map((cue) => cue.cueId)).toEqual(['welcome']);
    expect(cues[0]?.second).toBeGreaterThanOrEqual(6 - DT);
  });

  it('clears only its own hint, never one that replaced it', () => {
    const context = makeContext();
    const ui = context.world.createEntity();
    context.world.addComponent(ui, UI_STATE, IDLE_UI_STATE);
    const { hints } = run(context, 12, [
      // Mid-ride, another System's key lands on the line (via the UI System
      // in a real world; written directly here as the observable state).
      {
        at: WELCOME_DELAY_SECONDS + 2,
        fire: (c) => c.world.addComponent(ui, UI_STATE, { ...IDLE_UI_STATE, hint: 'other.key' }),
      },
    ]);
    // Our welcome was published, but no clearing null follows: the line
    // now belongs to the other System.
    expect(hints.map((hint) => hint.key)).toEqual([ONBOARDING_WELCOME_KEY]);
  });
});

describe('the slice: one-shots persist, sessions replay clean (FR-ARCH-016)', () => {
  it('spawns fresh state at init and adopts an existing slice on re-init', () => {
    const context = makeContext();
    const system = createOnboardingSystem();
    system.init(context);
    expect(context.world.query(ONBOARDING_STATE)).toHaveLength(1);
    const [entity] = context.world.query(ONBOARDING_STATE);
    expect(entity).toBeDefined();
    if (entity !== undefined) {
      expect(context.world.getComponent(entity, ONBOARDING_STATE)).toEqual(FRESH_ONBOARDING);
    }

    system.teardown(context);
    system.init(context); // hot-reload: no duplicate slice
    expect(context.world.query(ONBOARDING_STATE)).toHaveLength(1);
  });

  it('replays no welcome and no mastered nudge for a restored visitor', () => {
    const context = makeContext();
    const slice = context.world.createEntity();
    // As applySave would land it: a visitor who saw the arc and learned it.
    context.world.addComponent(slice, ONBOARDING_STATE, {
      welcomed: true,
      moved: true,
      interacted: true,
      nudgedMove: true,
      nudgedInteract: true,
    });
    const { cues } = run(context, 30);
    expect(cues).toEqual([]);
  });
});
