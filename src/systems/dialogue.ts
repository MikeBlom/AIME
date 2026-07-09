/**
 * Dialogue System — traverses content dialogue node graphs through the UI
 * surface (issue #26; spec: docs/21-Dialogue-System.md).
 *
 * Dialogue documents spawn as entities carrying a DIALOGUE definition:
 * nodes with locale text keys, branching choices (`goto`), end flags, and
 * optional `resolves` hooks. The System owns the DIALOGUE_STATE slice (the
 * active traversal, FR-ARCH-015) and speaks only events: any System starts
 * a conversation by publishing `dialogue.start.requested` (the
 * `startDialogue(id)` contract, FR-ARCH-005); each visited node is
 * presented by publishing the UI System's `ui.dialogue.open` with locale
 * keys — never text (DATA-FR-011); the player's answer arrives back as the
 * UI's `ui.dialogue.chosen`, which advances the graph, fires the chosen
 * hook, and ends at end nodes with `dialogue.ended`.
 *
 * Hooks are how conversations touch the world: a choice or an end node may
 * declare `resolves { questId, objectiveId, outcome }`, published as the
 * quest engine's standardized `objective.resolved` feed — dialogue can
 * advance quests without knowing what a quest is (FR-ARCH-015).
 *
 * Determinism (NFR-ARCH-001): traversal is a pure function of the event
 * sequence and world state, delivered in the bus's defined order; unknown
 * dialogue ids, nodes, and stray UI events degrade silently (FR-ARCH-008).
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { OBJECTIVE_RESOLVED } from './quest';
import { UI_DIALOGUE_CHOSEN, UI_DIALOGUE_OPEN } from './ui';

/** A hook: resolving this objective is what the line or choice *does*. */
export type DialogueResolves = {
  readonly questId: string;
  readonly objectiveId: string;
  readonly outcome: 'solved' | 'bypassed';
};

/** One player choice: its locale key, where it leads, and its hook. */
export type DialogueChoice = {
  readonly textKey: string;
  readonly goto: string;
  readonly resolves: DialogueResolves | null;
};

/**
 * One node of the graph: the speaker line's locale key, its choices, the
 * end flag, and the hook fired when the conversation ends on this node.
 */
export type DialogueNode = {
  readonly id: string;
  readonly textKey: string;
  readonly end: boolean;
  readonly choices: readonly DialogueChoice[];
  readonly resolves: DialogueResolves | null;
};

/** A dialogue as spawned from its content document. Data only. */
export type DialogueDefinition = {
  readonly dialogueId: string;
  readonly nodes: readonly DialogueNode[];
};
export const DIALOGUE = defineComponentType<DialogueDefinition>('dialogue');

/** The System-owned traversal slice: which conversation is at which node. */
export type DialogueState = {
  readonly active: { readonly dialogueId: string; readonly nodeId: string } | null;
};
export const DIALOGUE_STATE = defineComponentType<DialogueState>('dialogue-state');

export const IDLE_DIALOGUE_STATE: DialogueState = { active: null };

/**
 * The `startDialogue(id)` contract as an event: any System (NPC
 * interaction, quests, onboarding) requests a conversation; nobody calls
 * this System (FR-ARCH-005). Ignored while another dialogue is active —
 * the surface is modal.
 */
export const DIALOGUE_START_REQUESTED = defineEventType<{ readonly dialogueId: string }>(
  'dialogue.start.requested',
);

/** A conversation began at its first node. */
export const DIALOGUE_STARTED = defineEventType<{
  readonly dialogueId: string;
  readonly nodeId: string;
}>('dialogue.started');

/** A conversation finished; `nodeId` is the node it ended on. */
export const DIALOGUE_ENDED = defineEventType<{
  readonly dialogueId: string;
  readonly nodeId: string;
}>('dialogue.ended');

/** Find the dialogue definition carrying this content id, if spawned. */
function dialogueById(world: EntityStore, dialogueId: string): DialogueDefinition | null {
  for (const entity of world.query(DIALOGUE)) {
    const definition = world.getComponent(entity, DIALOGUE);
    if (definition?.dialogueId === dialogueId) return definition;
  }
  return null;
}

function nodeOf(definition: DialogueDefinition, nodeId: string): DialogueNode | null {
  return definition.nodes.find((node) => node.id === nodeId) ?? null;
}

/** Present a node through the UI surface: locale keys only (DATA-FR-011). */
function presentNode(context: SystemContext, node: DialogueNode): void {
  context.events.publish(UI_DIALOGUE_OPEN, {
    textKey: node.textKey,
    choiceKeys: node.choices.map((choice) => choice.textKey),
  });
}

function fireResolves(context: SystemContext, resolves: DialogueResolves | null): void {
  if (resolves === null) return;
  context.events.publish(OBJECTIVE_RESOLVED, {
    questId: resolves.questId,
    objectiveId: resolves.objectiveId,
    outcome: resolves.outcome,
  });
}

/**
 * Build the Dialogue System. A factory because the System holds its event
 * subscriptions and slice entity between init and teardown; each booted
 * world composes a fresh instance (hot-reload safe).
 */
export function createDialogueSystem(): System {
  let unsubscribes: (() => void)[] = [];
  let stateEntity: EntityId | null = null;

  const stateOf = (world: EntityStore): DialogueState =>
    (stateEntity !== null ? world.getComponent(stateEntity, DIALOGUE_STATE) : undefined) ??
    IDLE_DIALOGUE_STATE;

  const setState = (world: EntityStore, state: DialogueState): void => {
    if (stateEntity !== null) world.addComponent(stateEntity, DIALOGUE_STATE, state);
  };

  const endConversation = (
    context: SystemContext,
    dialogueId: string,
    node: DialogueNode,
  ): void => {
    fireResolves(context, node.resolves);
    context.events.publish(DIALOGUE_ENDED, { dialogueId, nodeId: node.id });
    setState(context.world, IDLE_DIALOGUE_STATE);
  };

  return {
    id: 'dialogue',
    dependencies: [],
    init(context: SystemContext): void {
      // The traversal slice: adopt an existing entity (hot re-init) or
      // spawn one idle. This System is its sole writer (FR-ARCH-015).
      const existing = context.world.query(DIALOGUE_STATE)[0];
      if (existing === undefined) {
        stateEntity = context.world.createEntity();
        context.world.addComponent(stateEntity, DIALOGUE_STATE, IDLE_DIALOGUE_STATE);
      } else {
        stateEntity = existing;
      }

      unsubscribes.push(
        context.events.subscribe(DIALOGUE_START_REQUESTED, (event) => {
          const world = context.world;
          if (stateOf(world).active !== null) return; // surface is modal
          const definition = dialogueById(world, event.payload.dialogueId);
          const first = definition?.nodes[0];
          if (definition === null || first === undefined) return;
          setState(world, { active: { dialogueId: definition.dialogueId, nodeId: first.id } });
          presentNode(context, first);
          context.events.publish(DIALOGUE_STARTED, {
            dialogueId: definition.dialogueId,
            nodeId: first.id,
          });
        }),
      );

      unsubscribes.push(
        context.events.subscribe(UI_DIALOGUE_CHOSEN, (event) => {
          const world = context.world;
          const active = stateOf(world).active;
          if (active === null) return; // a surface this System did not open
          const definition = dialogueById(world, active.dialogueId);
          const node = definition === null ? null : nodeOf(definition, active.nodeId);
          if (definition === null || node === null) {
            // The definition vanished mid-conversation (content changed
            // shape): settle the slice instead of wedging it (FR-ARCH-008).
            setState(world, IDLE_DIALOGUE_STATE);
            return;
          }
          const index = event.payload.choiceIndex;
          const choice = index === null ? undefined : node.choices[index];
          if (choice === undefined) {
            // A plain advance (no choices on this node): the line was read.
            endConversation(context, active.dialogueId, node);
            return;
          }
          fireResolves(context, choice.resolves);
          const next = nodeOf(definition, choice.goto);
          if (next === null) {
            // A goto to a node that does not exist ends gracefully here.
            endConversation(context, active.dialogueId, node);
            return;
          }
          setState(world, { active: { dialogueId: active.dialogueId, nodeId: next.id } });
          presentNode(context, next);
        }),
      );
    },
    update(): void {},
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      stateEntity = null;
    },
  };
}

/**
 * The dialogue plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018).
 */
export function createDialoguePlugin(): Plugin {
  return {
    id: 'plugin.dialogue',
    systems: [createDialogueSystem()],
    componentTypes: [DIALOGUE, DIALOGUE_STATE],
    eventTypes: [DIALOGUE_START_REQUESTED, DIALOGUE_STARTED, DIALOGUE_ENDED],
  };
}
