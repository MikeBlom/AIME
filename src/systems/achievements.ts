/**
 * Achievements System — content-defined recognitions surfaced through
 * gameplay (issue #32; spec: docs/27-Achievements.md).
 *
 * Achievements are pure content: the composition root spawns one entity
 * per achievement document carrying an ACHIEVEMENT definition (locale keys
 * and an unlock rule, never inline text) plus the ACHIEVEMENT_STATE slice
 * this System owns (FR-ARCH-015). The rule vocabulary is the engine's;
 * what each rule binds to is the pack's (FR-ACH-002): membership and count
 * predicates over the Progression System's slice — restored regions,
 * completed quests, capabilities, items — plus the `building.entered`
 * event edge. Rules are re-evaluated every fixed step against shared world
 * state, so an unlock can never be missed by event timing (FR-ACH-003).
 *
 * Unlock feedback is non-intrusive (FR-ACH-004): the unlock is announced
 * (`achievement.unlocked`) for any consumer — the Audio System binds a cue
 * to it — and the achievement's title key rides the UI hint line as a
 * toast that clears itself after a few seconds of simulation time. No
 * modal, no interruption; a world without a UI System simply hears
 * nothing (FR-ARCH-008).
 *
 * Unlock state persists (FR-ACH-005): ACHIEVEMENT_STATE joins the save
 * slices, and an achievement restored as unlocked replays no feedback.
 *
 * Determinism (NFR-ARCH-001): update is pure with respect to (world
 * state, dt, buffered events); entities iterate in ascending id order; no
 * wall clock, no randomness (FR-ARCH-025).
 */
import type { ComponentData, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { BUILDING_ENTERED } from './building';
import type { Progression } from './progression';
import { EMPTY_PROGRESSION, PROGRESSION } from './progression';
import { UI_HINT } from './ui';

/** The engine's unlock-rule vocabulary; content binds the specifics. */
export type UnlockRule =
  | { readonly kind: 'restored-region'; readonly ref: string }
  | { readonly kind: 'restored-count'; readonly count: number }
  | { readonly kind: 'quest-completed'; readonly ref: string }
  | { readonly kind: 'capability-unlocked'; readonly ref: string }
  | { readonly kind: 'item-added'; readonly ref: string }
  | { readonly kind: 'building-entered'; readonly ref: string };

/**
 * An achievement as spawned from its content document: identity, locale
 * keys, and the unlock rule. Data only; a null rule never unlocks by
 * itself (content reserved for future vocabulary).
 */
export type AchievementDefinition = {
  readonly achievementId: string;
  readonly titleKey: string;
  readonly descriptionKey: string | null;
  readonly unlock: UnlockRule | null;
};
export const ACHIEVEMENT = defineComponentType<AchievementDefinition>('achievement');

/**
 * The unlock slice this System owns (FR-ARCH-015): plain serializable
 * data, captured by the save envelope (FR-ACH-005, FR-ARCH-016).
 */
export type AchievementState = { readonly unlocked: boolean };
export const ACHIEVEMENT_STATE = defineComponentType<AchievementState>('achievement-state');

export const LOCKED_ACHIEVEMENT: AchievementState = { unlocked: false };

/** A recognition landed (deferred): the feedback feed for UI and audio. */
export const ACHIEVEMENT_UNLOCKED = defineEventType<{
  readonly achievementId: string;
  readonly titleKey: string;
}>('achievement.unlocked');

/** How long the unlock toast rides the hint line, in simulation seconds. */
export const TOAST_SECONDS = 4;

const RULE_KINDS_WITH_REF: ReadonlySet<string> = new Set([
  'restored-region',
  'quest-completed',
  'capability-unlocked',
  'item-added',
  'building-entered',
]);

/**
 * Translate an achievement document's `unlock` block into the engine's
 * rule (the seam crossing): unknown kinds and malformed fields degrade to
 * null — the achievement simply never self-unlocks (FR-ARCH-008).
 */
export function readUnlockRule(value: ComponentData | undefined): UnlockRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, ComponentData>>;
  const kind = record['kind'];
  if (kind === 'restored-count') {
    const count = record['count'];
    return typeof count === 'number' && Number.isFinite(count) && count > 0
      ? { kind, count }
      : null;
  }
  const ref = record['ref'];
  if (typeof kind === 'string' && RULE_KINDS_WITH_REF.has(kind) && typeof ref === 'string') {
    return { kind: kind as Exclude<UnlockRule, { kind: 'restored-count' }>['kind'], ref };
  }
  return null;
}

/** The world's progression slice; empty when no System owns it. */
function progressionOf(world: EntityStore): Progression {
  for (const entity of world.query(PROGRESSION)) {
    const value = world.getComponent(entity, PROGRESSION);
    if (value !== undefined) return value;
  }
  return EMPTY_PROGRESSION;
}

/** Does the rule hold, given progression state and this step's entries? */
export function ruleSatisfied(
  rule: UnlockRule,
  progression: Progression,
  enteredBuildings: readonly string[],
): boolean {
  switch (rule.kind) {
    case 'restored-region':
      return progression.restored.includes(rule.ref);
    case 'restored-count':
      return progression.restored.length >= rule.count;
    case 'quest-completed':
      return progression.quests.includes(rule.ref);
    case 'capability-unlocked':
      return progression.capabilities.includes(rule.ref);
    case 'item-added':
      return progression.items.includes(rule.ref);
    case 'building-entered':
      return enteredBuildings.includes(rule.ref);
  }
}

/**
 * Build the Achievements System. A factory because the System buffers bus
 * events between flush and update and runs the toast countdown; each
 * booted world composes a fresh instance (hot-reload safe).
 */
export function createAchievementsSystem(): System {
  let enteredBuildings: string[] = [];
  let toastRemaining = 0;
  let unsubscribes: (() => void)[] = [];

  const reset = () => {
    enteredBuildings = [];
    toastRemaining = 0;
  };

  return {
    id: 'achievements',
    // Ordering only: evaluate after the Progression System recorded this
    // step's announcements. A world without progression holds an empty
    // record and count/membership rules simply wait (FR-ARCH-008).
    dependencies: ['progression'],
    init(context: SystemContext): void {
      reset();
      unsubscribes.push(
        context.events.subscribe(BUILDING_ENTERED, (event) => {
          if (typeof event.payload.buildingId === 'string') {
            enteredBuildings.push(event.payload.buildingId);
          }
        }),
      );
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      const progression = progressionOf(world);

      for (const entity of world.query(ACHIEVEMENT)) {
        const definition = world.getComponent(entity, ACHIEVEMENT);
        if (definition === undefined || definition.unlock === null) continue;
        const state = world.getComponent(entity, ACHIEVEMENT_STATE) ?? LOCKED_ACHIEVEMENT;
        if (state.unlocked) continue; // settled: restored unlocks replay nothing
        if (!ruleSatisfied(definition.unlock, progression, enteredBuildings)) continue;

        world.addComponent(entity, ACHIEVEMENT_STATE, { unlocked: true });
        context.events.publish(ACHIEVEMENT_UNLOCKED, {
          achievementId: definition.achievementId,
          titleKey: definition.titleKey,
        });
        // The toast (FR-ACH-004): the title key rides the hint line and
        // clears itself; text resolution stays the UI System's business.
        context.events.publish(UI_HINT, { textKey: definition.titleKey });
        toastRemaining = TOAST_SECONDS;
      }
      enteredBuildings = [];

      if (toastRemaining > 0) {
        toastRemaining = Math.max(0, toastRemaining - dt);
        if (toastRemaining === 0) context.events.publish(UI_HINT, { textKey: null });
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
 * The achievements plugin: the System plus the component and event types
 * it introduces, registered and removed as one unit (FR-ARCH-018). A
 * factory so every world composes a fresh System instance.
 */
export function createAchievementsPlugin(): Plugin {
  return {
    id: 'plugin.achievements',
    systems: [createAchievementsSystem()],
    componentTypes: [ACHIEVEMENT, ACHIEVEMENT_STATE],
    eventTypes: [ACHIEVEMENT_UNLOCKED],
  };
}
