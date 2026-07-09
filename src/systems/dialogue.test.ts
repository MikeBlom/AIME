/**
 * Dialogue System suite (issue #26): a branching dialogue plays through to
 * an end node with choices working (AC1), all text travels as locale keys
 * and traversal never depends on resolved text (AC2), and hooks feed the
 * quest engine's standardized result event — plus robustness (FR-ARCH-008)
 * and determinism (NFR-ARCH-001).
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { DialogueDefinition } from './dialogue';
import {
  createDialogueSystem,
  DIALOGUE,
  DIALOGUE_ENDED,
  DIALOGUE_START_REQUESTED,
  DIALOGUE_STARTED,
  DIALOGUE_STATE,
} from './dialogue';
import { INPUT_INTENT, INTENT_INTERACT } from './input';
import {
  createQuestSystem,
  initialQuestState,
  OBJECTIVE_RESOLVED,
  QUEST,
  QUEST_STATE,
} from './quest';
import { createUiSystem, UI_DIALOGUE_CHOSEN, UI_DIALOGUE_OPEN, UI_STATE } from './ui';

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

/** A three-node branch: n1 chooses between two endings. */
const BRANCHING: DialogueDefinition = {
  dialogueId: 'dialogue.sample',
  nodes: [
    {
      id: 'n1',
      textKey: 'dialogue.sample.n1',
      end: false,
      resolves: null,
      choices: [
        { textKey: 'dialogue.sample.n1.c1', goto: 'n2', resolves: null },
        { textKey: 'dialogue.sample.n1.c2', goto: 'n3', resolves: null },
      ],
    },
    { id: 'n2', textKey: 'dialogue.sample.n2', end: true, resolves: null, choices: [] },
    { id: 'n3', textKey: 'dialogue.sample.n3', end: true, resolves: null, choices: [] },
  ],
};

function spawnDialogue(
  context: SystemContext,
  definition: DialogueDefinition = BRANCHING,
): EntityId {
  const entity = context.world.createEntity();
  context.world.addComponent(entity, DIALOGUE, definition);
  return entity;
}

function initDialogue(context: SystemContext) {
  const system = createDialogueSystem();
  system.init(context);
  return system;
}

function flush(context: SystemContext, times = 2) {
  for (let i = 0; i < times; i += 1) context.events.flushDeferred();
}

/** Answer the open surface the way the UI System reports the player did. */
function choose(
  context: SystemContext,
  textKey: string,
  choiceKey: string | null,
  choiceIndex: number | null,
) {
  context.events.publish(UI_DIALOGUE_CHOSEN, { textKey, choiceKey, choiceIndex });
  flush(context);
}

function activeState(context: SystemContext) {
  const [entity] = context.world.query(DIALOGUE_STATE);
  return entity === undefined
    ? null
    : (context.world.getComponent(entity, DIALOGUE_STATE)?.active ?? null);
}

describe('branching traversal (AC1)', () => {
  it('plays a branching dialogue through to an end node with choices working', () => {
    const context = makeContext();
    spawnDialogue(context);
    initDialogue(context);
    const opened: (readonly [string, readonly string[]])[] = [];
    const started: string[] = [];
    const ended: (readonly [string, string])[] = [];
    context.events.subscribe(UI_DIALOGUE_OPEN, (event) =>
      opened.push([event.payload.textKey, event.payload.choiceKeys ?? []]),
    );
    context.events.subscribe(DIALOGUE_STARTED, (event) => started.push(event.payload.nodeId));
    context.events.subscribe(DIALOGUE_ENDED, (event) =>
      ended.push([event.payload.dialogueId, event.payload.nodeId]),
    );

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    expect(started).toEqual(['n1']);
    expect(opened).toEqual([
      ['dialogue.sample.n1', ['dialogue.sample.n1.c1', 'dialogue.sample.n1.c2']],
    ]);
    expect(activeState(context)).toEqual({ dialogueId: 'dialogue.sample', nodeId: 'n1' });

    // The second branch is chosen: traversal follows its goto.
    choose(context, 'dialogue.sample.n1', 'dialogue.sample.n1.c2', 1);
    expect(opened).toHaveLength(2);
    expect(opened[1]).toEqual(['dialogue.sample.n3', []]);
    expect(activeState(context)).toEqual({ dialogueId: 'dialogue.sample', nodeId: 'n3' });

    // Reading the end node closes the conversation.
    choose(context, 'dialogue.sample.n3', null, null);
    expect(ended).toEqual([['dialogue.sample', 'n3']]);
    expect(activeState(context)).toBeNull();
  });

  it('the first branch reaches its own ending', () => {
    const context = makeContext();
    spawnDialogue(context);
    initDialogue(context);
    const ended: string[] = [];
    context.events.subscribe(DIALOGUE_ENDED, (event) => ended.push(event.payload.nodeId));

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    choose(context, 'dialogue.sample.n1', 'dialogue.sample.n1.c1', 0);
    choose(context, 'dialogue.sample.n2', null, null);
    expect(ended).toEqual(['n2']);
  });

  it('renders through the UI System end to end: surface opens, advances, closes', () => {
    const context = makeContext();
    spawnDialogue(context);
    const dialogueSystem = initDialogue(context);
    const uiSystem = createUiSystem();
    uiSystem.init(context);
    void dialogueSystem;

    const uiState = () =>
      context.world
        .query(UI_STATE)
        .map((entity) => context.world.getComponent(entity, UI_STATE))
        .find((value) => value !== undefined);

    // Start: the dialogue System opens the surface; the UI System shows it.
    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    uiSystem.update(DT, context);
    expect(uiState()?.dialogue).toMatchObject({ textKey: 'dialogue.sample.n1', selected: 0 });
    expect(uiState()?.modal).toBe(true);

    // The player interacts: the UI reports the selected choice; the
    // dialogue System advances the graph and reopens the next node.
    const intent = context.world.createEntity();
    context.world.addComponent(intent, INPUT_INTENT, {
      moveX: 0,
      moveY: 0,
      toX: null,
      toY: null,
      interact: true,
    });
    context.events.publish(INTENT_INTERACT, {});
    context.events.flushDeferred();
    uiSystem.update(DT, context); // publishes ui.dialogue.chosen (choice 0)
    flush(context); // dialogue advances to n2, reopens the surface
    uiSystem.update(DT, context);
    expect(uiState()?.dialogue).toMatchObject({ textKey: 'dialogue.sample.n2' });
  });
});

describe('locale keys only (AC2)', () => {
  it('presents nodes as locale keys and never depends on resolved text', () => {
    const context = makeContext(); // note: no strings table exists at all
    spawnDialogue(context);
    initDialogue(context);
    const opened: string[] = [];
    context.events.subscribe(UI_DIALOGUE_OPEN, (event) => opened.push(event.payload.textKey));

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    choose(context, 'dialogue.sample.n1', 'dialogue.sample.n1.c1', 0);
    choose(context, 'dialogue.sample.n2', null, null);

    // Traversal completed entirely on keys; what a key displays (and how a
    // missing non-default key falls back, DATA-FR-025) is the UI/locale
    // layer's concern.
    expect(opened).toEqual(['dialogue.sample.n1', 'dialogue.sample.n2']);
    expect(opened.every((key) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(key))).toBe(true);
    expect(activeState(context)).toBeNull();
  });
});

describe('hooks: dialogue advances quests', () => {
  const HOOKED: DialogueDefinition = {
    dialogueId: 'dialogue.hooked',
    nodes: [
      {
        id: 'n1',
        textKey: 'dialogue.hooked.n1',
        end: false,
        resolves: null,
        choices: [
          {
            textKey: 'dialogue.hooked.n1.c1',
            goto: 'n2',
            resolves: { questId: 'quest.sample', objectiveId: 'obj.talk', outcome: 'solved' },
          },
        ],
      },
      {
        id: 'n2',
        textKey: 'dialogue.hooked.n2',
        end: true,
        resolves: { questId: 'quest.sample', objectiveId: 'obj.listen', outcome: 'bypassed' },
        choices: [],
      },
    ],
  };

  it('publishes the standardized objective.resolved feed from choices and end nodes', () => {
    const context = makeContext();
    spawnDialogue(context, HOOKED);
    initDialogue(context);
    const resolved: (readonly [string, string, string])[] = [];
    context.events.subscribe(OBJECTIVE_RESOLVED, (event) =>
      resolved.push([event.payload.questId, event.payload.objectiveId, event.payload.outcome]),
    );

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.hooked' });
    flush(context);
    choose(context, 'dialogue.hooked.n1', 'dialogue.hooked.n1.c1', 0); // choice hook
    choose(context, 'dialogue.hooked.n2', null, null); // end-node hook
    expect(resolved).toEqual([
      ['quest.sample', 'obj.talk', 'solved'],
      ['quest.sample', 'obj.listen', 'bypassed'],
    ]);
  });

  it('a conversation completes a quest through the quest engine', () => {
    const context = makeContext();
    spawnDialogue(context, HOOKED);
    const definition = {
      questId: 'quest.sample',
      titleKey: 'quest.sample.title',
      regionRef: 'region.sample',
      objectives: [
        { id: 'obj.talk', descriptionKey: 'quest.sample.obj.talk' },
        { id: 'obj.listen', descriptionKey: 'quest.sample.obj.listen' },
      ],
      emitsOnComplete: [],
      revealsKey: null,
      bypassAllowed: true,
      bypassRevealsKey: null,
    };
    const quest = context.world.createEntity();
    context.world.addComponent(quest, QUEST, definition);
    context.world.addComponent(quest, QUEST_STATE, initialQuestState(definition));
    initDialogue(context);
    createQuestSystem().init(context);

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.hooked' });
    flush(context);
    choose(context, 'dialogue.hooked.n1', 'dialogue.hooked.n1.c1', 0);
    flush(context); // deliver objective.resolved to the quest engine
    choose(context, 'dialogue.hooked.n2', null, null);
    flush(context);

    expect(context.world.getComponent(quest, QUEST_STATE)).toEqual({
      status: 'completed',
      objectives: { 'obj.talk': 'solved', 'obj.listen': 'bypassed' },
    });
  });
});

describe('robustness (FR-ARCH-008) and lifecycle', () => {
  it('ignores unknown dialogue ids, stray chosen events, and double starts', () => {
    const context = makeContext();
    spawnDialogue(context);
    initDialogue(context);
    const opened: string[] = [];
    context.events.subscribe(UI_DIALOGUE_OPEN, (event) => opened.push(event.payload.textKey));

    expect(() => {
      context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.unknown' });
      flush(context);
      choose(context, 'anything', null, null); // no active conversation
    }).not.toThrow();
    expect(opened).toEqual([]);

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    expect(opened).toEqual(['dialogue.sample.n1']); // modal: the second start is ignored
  });

  it('a goto to a missing node ends the conversation gracefully', () => {
    const context = makeContext();
    spawnDialogue(context, {
      dialogueId: 'dialogue.broken',
      nodes: [
        {
          id: 'n1',
          textKey: 'dialogue.broken.n1',
          end: false,
          resolves: null,
          choices: [{ textKey: 'dialogue.broken.n1.c1', goto: 'n9', resolves: null }],
        },
      ],
    });
    initDialogue(context);
    const ended: string[] = [];
    context.events.subscribe(DIALOGUE_ENDED, (event) => ended.push(event.payload.nodeId));

    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.broken' });
    flush(context);
    choose(context, 'dialogue.broken.n1', 'dialogue.broken.n1.c1', 0);
    expect(ended).toEqual(['n1']);
    expect(activeState(context)).toBeNull();
  });

  it('stops reacting after teardown (hot-reload safe)', () => {
    const context = makeContext();
    spawnDialogue(context);
    const system = initDialogue(context);
    system.teardown(context);
    const opened: string[] = [];
    context.events.subscribe(UI_DIALOGUE_OPEN, (event) => opened.push(event.payload.textKey));
    context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
    flush(context);
    expect(opened).toEqual([]);
  });
});

describe('determinism (NFR-ARCH-001)', () => {
  it('identical scripts reproduce identical traversal and event sequences', () => {
    const run = () => {
      const context = makeContext();
      spawnDialogue(context);
      initDialogue(context);
      context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: 'dialogue.sample' });
      flush(context);
      choose(context, 'dialogue.sample.n1', 'dialogue.sample.n1.c2', 1);
      choose(context, 'dialogue.sample.n3', null, null);
      return context.events.eventLog.map((entry) => [entry.kind, entry.type]);
    };
    expect(run()).toEqual(run());
  });
});
