/**
 * Inventory and Progression System — the world-state record of what the
 * player has restored, unlocked, and collected (issue #31; spec:
 * docs/26-Inventory-and-Progression.md).
 *
 * Progression is restoration (Vision): the slice this System owns
 * (FR-ARCH-015) tracks the regions brought back online, the quests
 * completed, and the capabilities and inventory items those completions
 * granted. Every mutation is event-driven (FR-INV-002): the quest engine
 * announces `system.restored` and `quest.completed`, this System records
 * them — no System writes the slice directly, and this System writes
 * nothing but its slice. What a quest grants is content: the quest
 * document's `onComplete.grants` block names capability and item ids,
 * carried on the spawned QUEST definition and read here as shared world
 * state (FR-INV-003). The engine knows no capability or item by name
 * (DATA-FR-027).
 *
 * Every list is kept ascending and duplicate-free, so the slice is
 * canonical: the same events in any arrival order within a tick produce
 * the same stored value, and saves diff cleanly. New capabilities and
 * items are announced (`progression.capability-unlocked`,
 * `progression.item-added`) along with a `progression.changed` summary,
 * the read feed for UI and achievements (FR-INV-004). The slice joins the
 * persisted progression slices, so all of it survives save/load
 * (FR-INV-005, FR-ARCH-016).
 *
 * Determinism (NFR-ARCH-001): update is pure with respect to (world
 * state, buffered events); no wall clock, no randomness (FR-ARCH-025).
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { QUEST, QUEST_COMPLETED, SYSTEM_RESTORED } from './quest';

/**
 * The progression slice, owned by this System (FR-ARCH-015): restored
 * region ids, completed quest ids, unlocked capability ids, and held
 * inventory item ids — each ascending and duplicate-free. All ids are
 * pack content; plain serializable data (FR-ARCH-016).
 */
export type Progression = {
  readonly restored: readonly string[];
  readonly quests: readonly string[];
  readonly capabilities: readonly string[];
  readonly items: readonly string[];
};
export const PROGRESSION = defineComponentType<Progression>('progression');

export const EMPTY_PROGRESSION: Progression = {
  restored: [],
  quests: [],
  capabilities: [],
  items: [],
};

/** A content-declared capability came into effect (deferred). */
export const CAPABILITY_UNLOCKED = defineEventType<{
  readonly capabilityId: string;
  readonly questId: string;
}>('progression.capability-unlocked');

/** A content-declared inventory item was collected (deferred). */
export const ITEM_ADDED = defineEventType<{
  readonly itemId: string;
  readonly questId: string;
}>('progression.item-added');

/**
 * The slice changed: the summary counts UI and achievements consume
 * without knowing quests or regions (FR-INV-004).
 */
export const PROGRESSION_CHANGED = defineEventType<{
  readonly restored: number;
  readonly quests: number;
  readonly capabilities: number;
  readonly items: number;
}>('progression.changed');

/** Insert preserving ascending order and uniqueness; same array if present. */
function withEntry(list: readonly string[], entry: string): readonly string[] {
  if (list.includes(entry)) return list;
  return [...list, entry].sort();
}

/** The spawned QUEST definition carrying this content quest id, if any. */
function questDefinition(world: EntityStore, questId: string) {
  for (const entity of world.query(QUEST)) {
    const definition = world.getComponent(entity, QUEST);
    if (definition?.questId === questId) return definition;
  }
  return null;
}

/**
 * Build the Inventory and Progression System. A factory because the
 * System buffers bus events between flush and update and tracks its
 * adopted slice entity; each booted world composes a fresh instance
 * (hot-reload safe).
 */
export function createProgressionSystem(): System {
  let pendingRestored: string[] = [];
  let pendingQuests: string[] = [];
  let unsubscribes: (() => void)[] = [];
  let sliceEntity: EntityId | null = null;

  const reset = () => {
    pendingRestored = [];
    pendingQuests = [];
    sliceEntity = null;
  };

  return {
    id: 'progression',
    // Ordering only: record after the quest engine settled this step's
    // resolutions. A world without a Quest System simply hears no events
    // and holds an empty record (FR-ARCH-008).
    dependencies: ['quest'],
    init(context: SystemContext): void {
      reset();
      // The progression slice: adopt an existing entity (hot re-init) or
      // spawn one empty. This System is its sole writer (FR-ARCH-015).
      const existing = context.world.query(PROGRESSION)[0];
      if (existing === undefined) {
        sliceEntity = context.world.createEntity();
        context.world.addComponent(sliceEntity, PROGRESSION, EMPTY_PROGRESSION);
      } else {
        sliceEntity = existing;
      }
      unsubscribes.push(
        context.events.subscribe(SYSTEM_RESTORED, (event) => {
          if (typeof event.payload.regionId === 'string') {
            pendingRestored.push(event.payload.regionId);
          }
        }),
      );
      unsubscribes.push(
        context.events.subscribe(QUEST_COMPLETED, (event) => {
          if (typeof event.payload.questId === 'string') {
            pendingQuests.push(event.payload.questId);
          }
        }),
      );
    },
    update(_dt: number, context: SystemContext): void {
      if (sliceEntity === null) return;
      if (pendingRestored.length === 0 && pendingQuests.length === 0) return;
      const world = context.world;
      const state = world.getComponent(sliceEntity, PROGRESSION) ?? EMPTY_PROGRESSION;
      let next = state;

      for (const regionId of pendingRestored) {
        if (next.restored.includes(regionId)) continue; // idempotent (FR-INV-006)
        next = { ...next, restored: withEntry(next.restored, regionId) };
      }
      pendingRestored = [];

      for (const questId of pendingQuests) {
        if (next.quests.includes(questId)) continue; // settled quests re-announce nothing
        next = { ...next, quests: withEntry(next.quests, questId) };
        // The quest's content-declared grants (FR-INV-003); a quest whose
        // definition is not spawned still counts as completed (FR-ARCH-008).
        const definition = questDefinition(world, questId);
        for (const capabilityId of definition?.grantsCapabilities ?? []) {
          if (next.capabilities.includes(capabilityId)) continue;
          next = { ...next, capabilities: withEntry(next.capabilities, capabilityId) };
          context.events.publish(CAPABILITY_UNLOCKED, { capabilityId, questId });
        }
        for (const itemId of definition?.grantsItems ?? []) {
          if (next.items.includes(itemId)) continue;
          next = { ...next, items: withEntry(next.items, itemId) };
          context.events.publish(ITEM_ADDED, { itemId, questId });
        }
      }
      pendingQuests = [];

      if (next !== state) {
        world.addComponent(sliceEntity, PROGRESSION, next);
        context.events.publish(PROGRESSION_CHANGED, {
          restored: next.restored.length,
          quests: next.quests.length,
          capabilities: next.capabilities.length,
          items: next.items.length,
        });
      }
    },
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      reset();
    },
  };
}

/**
 * The progression plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createProgressionPlugin(): Plugin {
  return {
    id: 'plugin.progression',
    systems: [createProgressionSystem()],
    componentTypes: [PROGRESSION],
    eventTypes: [CAPABILITY_UNLOCKED, ITEM_ADDED, PROGRESSION_CHANGED],
  };
}
