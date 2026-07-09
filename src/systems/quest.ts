/**
 * Quest Engine (Restoration) — the data-driven state machine behind the
 * core narrative act: bringing offline systems back online (issue #25;
 * spec: docs/20-Quest-Engine.md; FR-VIS-004).
 *
 * Quests are pure content: the composition root spawns one entity per
 * quest document carrying a QUEST definition (locale keys and ids, never
 * inline text) plus the QUEST_STATE progress slice this System owns
 * (FR-ARCH-015). Gameplay Systems — mini-games, dialogue, interactions —
 * report a bound mechanic's outcome by publishing `objective.resolved`;
 * this System records it, announces `quest.advanced`, and when every
 * objective is resolved completes the quest: it emits the content-declared
 * completion events (the engine vocabulary maps `SystemRestored` to
 * `system.restored`), flips the quest's region to online, and reveals the
 * career meaning as a locale key on `quest.revealed`.
 *
 * The bypass path (FR-VIS-010): a `bypassed` outcome — when the quest's
 * content allows it — resolves the objective AND reveals the meaning
 * immediately, so difficulty never gates comprehension or progression.
 * A disallowed bypass is ignored.
 *
 * Determinism (NFR-ARCH-001): all mutations happen in event handlers
 * delivered in the bus's defined order at the tick boundary (FR-ARCH-010/
 * 012); no wall clock, no randomness. Unknown quest or objective ids
 * degrade silently (FR-ARCH-008).
 */
import type { EntityId, EntityStore, EventType, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { REGION } from './scene';

/** One step of a quest, described entirely by content locale keys. */
export type QuestObjective = { readonly id: string; readonly descriptionKey: string };

/**
 * A quest as spawned from its content document: identity, locale keys,
 * the region it restores, its objectives, and the completion/bypass
 * declarations. Data only — which quest means what is the pack's business.
 */
export type QuestDefinition = {
  readonly questId: string;
  readonly titleKey: string;
  readonly regionRef: string;
  readonly objectives: readonly QuestObjective[];
  /** Engine-vocabulary event names content asks to emit on completion. */
  readonly emitsOnComplete: readonly string[];
  readonly revealsKey: string | null;
  readonly bypassAllowed: boolean;
  readonly bypassRevealsKey: string | null;
};
export const QUEST = defineComponentType<QuestDefinition>('quest');

/** How an objective was resolved, or that it still waits. */
export type ObjectiveStatus = 'pending' | 'solved' | 'bypassed';

/**
 * The progress slice this System owns (FR-ARCH-015): per-objective status
 * plus the quest's lifecycle. Plain serializable data, captured by the
 * save envelope so progress survives resume (FR-ARCH-016).
 */
export type QuestState = {
  readonly status: 'active' | 'completed';
  readonly objectives: { readonly [objectiveId: string]: ObjectiveStatus };
};
export const QUEST_STATE = defineComponentType<QuestState>('quest-state');

/** The pristine state for a definition: active, every objective pending. */
export function initialQuestState(definition: QuestDefinition): QuestState {
  const objectives: Record<string, ObjectiveStatus> = {};
  for (const objective of definition.objectives) objectives[objective.id] = 'pending';
  return { status: 'active', objectives };
}

/**
 * Published BY gameplay Systems (mini-games host, dialogue, interactions)
 * when a mechanic bound to an objective resolves — the standardized result
 * feed the quest engine consumes (FR-ARCH-015: others request, this System
 * writes).
 */
export const OBJECTIVE_RESOLVED = defineEventType<{
  readonly questId: string;
  readonly objectiveId: string;
  readonly outcome: 'solved' | 'bypassed';
}>('objective.resolved');

/** An objective landed: the quest moved forward (deferred, FR-ARCH-012). */
export const QUEST_ADVANCED = defineEventType<{
  readonly questId: string;
  readonly objectiveId: string;
  readonly outcome: 'solved' | 'bypassed';
}>('quest.advanced');

/** Every objective resolved: the quest is done. */
export const QUEST_COMPLETED = defineEventType<{ readonly questId: string }>('quest.completed');

/**
 * The career meaning behind a quest is available: `revealsKey` is a locale
 * key UI surfaces — the engine never carries the text (FR-VIS-007).
 */
export const QUEST_REVEALED = defineEventType<{
  readonly questId: string;
  readonly revealsKey: string;
}>('quest.revealed');

/**
 * The restoration beat (docs/02's `SystemRestored`): a region came back
 * online. Emitted when a completing quest's content declares it.
 */
export const SYSTEM_RESTORED = defineEventType<{
  readonly questId: string;
  readonly regionId: string;
}>('system.restored');

/** A region's live state changed (offline -> online on restoration). */
export const REGION_STATE_CHANGED = defineEventType<{
  readonly regionId: string;
  readonly state: string;
}>('region.state.changed');

/** The region live states the restoration arc moves between. */
export const REGION_ONLINE = 'online';

/**
 * The engine vocabulary of completion events content may declare in
 * `onComplete.emits` (DATA schema `quest`). Unknown names degrade silently
 * (FR-ARCH-008): a pack asking for an event this engine version does not
 * know still completes its quest.
 */
const COMPLETION_VOCABULARY: ReadonlyMap<
  string,
  EventType<{ readonly questId: string; readonly regionId: string }>
> = new Map([['SystemRestored', SYSTEM_RESTORED]]);

/** Find the quest entity carrying this content quest id, if spawned. */
function questEntityById(world: EntityStore, questId: string): EntityId | null {
  for (const entity of world.query(QUEST)) {
    if (world.getComponent(entity, QUEST)?.questId === questId) return entity;
  }
  return null;
}

/** Flip the quest's region entity online and announce the transition. */
function bringRegionOnline(context: SystemContext, definition: QuestDefinition): void {
  for (const entity of context.world.query(REGION)) {
    const region = context.world.getComponent(entity, REGION);
    if (region === undefined || region.contentId !== definition.regionRef) continue;
    if (region.state === REGION_ONLINE) return;
    context.world.addComponent(entity, REGION, { ...region, state: REGION_ONLINE });
    context.events.publish(REGION_STATE_CHANGED, {
      regionId: definition.regionRef,
      state: REGION_ONLINE,
    });
    return;
  }
  // No spawned region entity (a quest for an unloaded region): the quest
  // still completes and announces; the world effect simply has no target.
}

/** Record one resolved objective and run completion when the quest is done. */
function resolveObjective(
  context: SystemContext,
  payload: { questId: string; objectiveId: string; outcome: 'solved' | 'bypassed' },
): void {
  const world = context.world;
  const entity = questEntityById(world, payload.questId);
  if (entity === null) return; // unknown quest: degrade (FR-ARCH-008)
  const definition = world.getComponent(entity, QUEST);
  const state = world.getComponent(entity, QUEST_STATE);
  if (definition === undefined || state === undefined) return;
  if (state.status === 'completed') return; // done quests are settled
  const current = state.objectives[payload.objectiveId];
  if (current === undefined || current !== 'pending') return; // unknown or already resolved
  if (payload.outcome === 'bypassed' && !definition.bypassAllowed) return; // content forbids it

  const objectives = { ...state.objectives, [payload.objectiveId]: payload.outcome };
  const completed = Object.values(objectives).every((status) => status !== 'pending');
  world.addComponent(entity, QUEST_STATE, {
    status: completed ? 'completed' : 'active',
    objectives,
  });
  context.events.publish(QUEST_ADVANCED, { ...payload });

  // The bypass path reveals the meaning NOW — comprehension is never gated
  // behind the puzzle the player could not (or chose not to) solve.
  if (payload.outcome === 'bypassed' && definition.bypassRevealsKey !== null) {
    context.events.publish(QUEST_REVEALED, {
      questId: definition.questId,
      revealsKey: definition.bypassRevealsKey,
    });
  }

  if (!completed) return;
  context.events.publish(QUEST_COMPLETED, { questId: definition.questId });
  if (definition.revealsKey !== null) {
    context.events.publish(QUEST_REVEALED, {
      questId: definition.questId,
      revealsKey: definition.revealsKey,
    });
  }
  for (const name of definition.emitsOnComplete) {
    const type = COMPLETION_VOCABULARY.get(name);
    if (type === undefined) continue; // unknown vocabulary: degrade
    context.events.publish(type, {
      questId: definition.questId,
      regionId: definition.regionRef,
    });
  }
  bringRegionOnline(context, definition);
}

/**
 * Build the Quest System. A factory because the System holds its event
 * subscriptions between init and teardown; each booted world composes a
 * fresh instance (hot-reload safe).
 */
export function createQuestSystem(): System {
  let unsubscribes: (() => void)[] = [];
  return {
    id: 'quest',
    dependencies: [],
    init(context: SystemContext): void {
      unsubscribes.push(
        context.events.subscribe(OBJECTIVE_RESOLVED, (event) => {
          resolveObjective(context, {
            questId: event.payload.questId,
            objectiveId: event.payload.objectiveId,
            outcome: event.payload.outcome,
          });
        }),
      );
    },
    update(): void {},
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
    },
  };
}

/**
 * The quest plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018).
 */
export function createQuestPlugin(): Plugin {
  return {
    id: 'plugin.quest',
    systems: [createQuestSystem()],
    componentTypes: [QUEST, QUEST_STATE],
    eventTypes: [
      OBJECTIVE_RESOLVED,
      QUEST_ADVANCED,
      QUEST_COMPLETED,
      QUEST_REVEALED,
      SYSTEM_RESTORED,
      REGION_STATE_CHANGED,
    ],
  };
}
