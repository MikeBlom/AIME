/**
 * Mini-Games host framework (issue #33; spec: docs/28-Mini-Games-Framework.md).
 *
 * Mechanics are metaphors for accomplishments (the Vision Metaphor Rule):
 * the engine provides mechanic *types*; which accomplishment binds to which
 * mechanic, with what params and framing, is pack data (DATA-FR-009/010).
 * The host is the one System between them. A gameplay System publishes
 * `minigame.launch { questId, objectiveId }`; the host resolves the quest's
 * content-declared `metaphorRef` to its spawned binding, confirms the
 * mechanic type is registered, opens the single host-owned session slice
 * (FR-ARCH-015), and announces `minigame.started`.
 *
 * The common mechanic lifecycle maps onto events and the update loop, never
 * calls (FR-ARCH-005): **enter** on `minigame.started` naming the mechanic,
 * **play** inside `update(dt)` while the session is active, **resolve** by
 * publishing `minigame.resolved` with `success` or `bypass`, **exit** on
 * `minigame.ended`. The host translates a resolution into the Quest
 * Engine's standardized `objective.resolved` feed (`success -> solved`,
 * `bypass -> bypassed`, FR-QST-003/FR-VIS-010) and closes the session.
 *
 * Determinism (NFR-ARCH-001): sessions advance only on deferred events,
 * world state, and simulation `dt`. Launches for busy sessions, unknown
 * quests, settled objectives, missing bindings, or unregistered mechanics
 * degrade silently, as do resolutions with no matching session
 * (FR-ARCH-008).
 */
import type { ComponentData, EntityId, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { OBJECTIVE_RESOLVED, QUEST, QUEST_STATE } from './quest';

/** Mechanic-specific configuration as validated content declared it. */
export type MechanicParams = Readonly<Record<string, ComponentData>>;

/**
 * A metaphor binding as spawned from its content document: the
 * accomplishment -> mechanic mapping with params and the framing locale
 * key. Data only — the accomplishment itself never reaches the engine
 * (DATA-FR-010).
 */
export type MetaphorBinding = {
  readonly metaphorId: string;
  readonly mechanicId: string;
  readonly params: MechanicParams;
  readonly framingKey: string;
};
export const METAPHOR = defineComponentType<MetaphorBinding>('metaphor');

/**
 * A registered mechanic type's descriptor: written into world state by the
 * mechanic System at init and retracted at teardown, so registration is
 * queryable (FR-MGF-001) and the host never references the System itself.
 */
export type MechanicDescriptor = { readonly mechanicId: string };
export const MECHANIC_TYPE = defineComponentType<MechanicDescriptor>('mechanic-type');

/** Everything a mechanic may read about the session it is playing. */
export type MinigameSession = {
  readonly mechanicId: string;
  readonly metaphorId: string;
  readonly questId: string;
  readonly objectiveId: string;
  readonly params: MechanicParams;
  readonly framingKey: string;
};

/**
 * The host-owned session slice (FR-ARCH-015/FR-MGF-004): at most one
 * mini-game is active. Deliberately not save-captured — a mid-minigame
 * save resumes at the quest, not inside the puzzle.
 */
export type MinigameSessionState = { readonly active: MinigameSession | null };
export const MINIGAME_SESSION = defineComponentType<MinigameSessionState>('minigame-session');
export const IDLE_MINIGAME_SESSION: MinigameSessionState = { active: null };

/**
 * The launch API from quests (FR-MGF-003): published by gameplay Systems
 * (interactions, UI) to start the mini-game bound to a quest objective.
 */
export const MINIGAME_LAUNCH_REQUESTED = defineEventType<{
  readonly questId: string;
  readonly objectiveId: string;
}>('minigame.launch');

/** A session opened: the named mechanic's cue to enter (params ride the slice). */
export const MINIGAME_STARTED = defineEventType<{
  readonly mechanicId: string;
  readonly metaphorId: string;
  readonly questId: string;
  readonly objectiveId: string;
  readonly framingKey: string;
}>('minigame.started');

/** How a mechanic concluded: solved honestly, or the bypass was taken (FR-VIS-010). */
export type MechanicOutcome = 'success' | 'bypass';

/**
 * Published BY mechanic Systems when play concludes — the standardized
 * result event the host forwards to the quest engine (FR-MGF-005/006).
 */
export const MINIGAME_RESOLVED = defineEventType<{
  readonly questId: string;
  readonly objectiveId: string;
  readonly outcome: MechanicOutcome;
}>('minigame.resolved');

/** The session closed after forwarding its result: the mechanic's cue to exit. */
export const MINIGAME_ENDED = defineEventType<{
  readonly mechanicId: string;
  readonly questId: string;
  readonly objectiveId: string;
  readonly outcome: MechanicOutcome;
}>('minigame.ended');

/** The host's translation of mechanic outcomes into the quest vocabulary. */
const OUTCOME_TO_OBJECTIVE = { success: 'solved', bypass: 'bypassed' } as const;

/** The session slice entity, reused across re-inits (hot-reload safe). */
function sessionEntity(context: SystemContext): EntityId {
  const existing = context.world.query(MINIGAME_SESSION)[0];
  if (existing !== undefined) return existing;
  const entity = context.world.createEntity();
  context.world.addComponent(entity, MINIGAME_SESSION, IDLE_MINIGAME_SESSION);
  return entity;
}

/** The active session, or null when the world is between mini-games. */
export function activeMinigameSession(context: SystemContext): MinigameSession | null {
  const entity = context.world.query(MINIGAME_SESSION)[0];
  if (entity === undefined) return null;
  return context.world.getComponent(entity, MINIGAME_SESSION)?.active ?? null;
}

/** The spawned metaphor binding carrying this content id, if any. */
function metaphorById(context: SystemContext, metaphorId: string): MetaphorBinding | null {
  for (const entity of context.world.query(METAPHOR)) {
    const binding = context.world.getComponent(entity, METAPHOR);
    if (binding?.metaphorId === metaphorId) return binding;
  }
  return null;
}

/** True when a mechanic System has registered this mechanic id (FR-MGF-001). */
function mechanicRegistered(context: SystemContext, mechanicId: string): boolean {
  for (const entity of context.world.query(MECHANIC_TYPE)) {
    if (context.world.getComponent(entity, MECHANIC_TYPE)?.mechanicId === mechanicId) return true;
  }
  return false;
}

/**
 * Open a session for a launch request when every precondition holds:
 * no active session, an active quest with the objective still pending, a
 * spawned metaphor binding, and a registered mechanic. Anything else is
 * ignored silently (FR-MGF-003/004, FR-ARCH-008).
 */
function launchSession(
  context: SystemContext,
  payload: { questId: string; objectiveId: string },
): void {
  const entity = sessionEntity(context);
  const state = context.world.getComponent(entity, MINIGAME_SESSION);
  if (state === undefined || state.active !== null) return; // one at a time

  for (const questEntity of context.world.query(QUEST, QUEST_STATE)) {
    const definition = context.world.getComponent(questEntity, QUEST);
    if (definition === undefined || definition.questId !== payload.questId) continue;
    const progress = context.world.getComponent(questEntity, QUEST_STATE);
    if (progress === undefined || progress.status !== 'active') return;
    if (progress.objectives[payload.objectiveId] !== 'pending') return;
    const metaphorRef = definition.metaphorRef ?? null;
    if (metaphorRef === null) return; // quest binds no mechanic
    const binding = metaphorById(context, metaphorRef);
    if (binding === null) return; // binding not spawned
    if (!mechanicRegistered(context, binding.mechanicId)) return; // no one to serve it

    const session: MinigameSession = {
      mechanicId: binding.mechanicId,
      metaphorId: binding.metaphorId,
      questId: payload.questId,
      objectiveId: payload.objectiveId,
      params: binding.params,
      framingKey: binding.framingKey,
    };
    context.world.addComponent(entity, MINIGAME_SESSION, { active: session });
    context.events.publish(MINIGAME_STARTED, {
      mechanicId: session.mechanicId,
      metaphorId: session.metaphorId,
      questId: session.questId,
      objectiveId: session.objectiveId,
      framingKey: session.framingKey,
    });
    return;
  }
  // Unknown quest id: degrade (FR-ARCH-008).
}

/**
 * Forward a mechanic's resolution to the quest engine and close the
 * session (FR-MGF-006). A resolution that does not match the active
 * session — stale, duplicated, or spoofed — changes nothing.
 */
function resolveSession(
  context: SystemContext,
  payload: { questId: string; objectiveId: string; outcome: MechanicOutcome },
): void {
  const entity = context.world.query(MINIGAME_SESSION)[0];
  if (entity === undefined) return;
  const active = context.world.getComponent(entity, MINIGAME_SESSION)?.active ?? null;
  if (active === null) return;
  if (active.questId !== payload.questId || active.objectiveId !== payload.objectiveId) return;

  context.world.addComponent(entity, MINIGAME_SESSION, IDLE_MINIGAME_SESSION);
  context.events.publish(OBJECTIVE_RESOLVED, {
    questId: active.questId,
    objectiveId: active.objectiveId,
    outcome: OUTCOME_TO_OBJECTIVE[payload.outcome],
  });
  context.events.publish(MINIGAME_ENDED, {
    mechanicId: active.mechanicId,
    questId: active.questId,
    objectiveId: active.objectiveId,
    outcome: payload.outcome,
  });
}

/**
 * Build the host System: owns the session slice, serves the launch API,
 * and forwards resolutions to the quest engine. A factory because it holds
 * subscriptions between init and teardown (hot-reload safe).
 */
export function createMinigameHostSystem(): System {
  let unsubscribes: (() => void)[] = [];
  return {
    id: 'minigame-host',
    dependencies: [],
    init(context: SystemContext): void {
      sessionEntity(context);
      unsubscribes.push(
        context.events.subscribe(MINIGAME_LAUNCH_REQUESTED, (event) => {
          launchSession(context, {
            questId: event.payload.questId,
            objectiveId: event.payload.objectiveId,
          });
        }),
        context.events.subscribe(MINIGAME_RESOLVED, (event) => {
          resolveSession(context, {
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
 * A mechanic type's authoring surface: the hooks the common lifecycle maps
 * onto (FR-MGF-005). `play` runs each fixed step while this mechanic's
 * session is active and resolves by returning an outcome; hooks read only
 * the Context and the session — never another System.
 */
export interface MechanicSpec {
  /** The engine mechanic id content binds to, e.g. `engine.mechanic.route-and-balance`. */
  readonly mechanicId: string;
  /** Extra soft ordering dependencies beyond the host (FR-ARCH-006). */
  readonly dependencies?: readonly string[];
  enter?(session: MinigameSession, context: SystemContext): void;
  play?(dt: number, session: MinigameSession, context: SystemContext): MechanicOutcome | null;
  exit?(
    result: { readonly session: MinigameSession; readonly outcome: MechanicOutcome },
    context: SystemContext,
  ): void;
}

/**
 * Build a conformant mechanic System from a spec: registers the descriptor
 * at init, retracts it at teardown (FR-MGF-001), enters on its own
 * `minigame.started`, plays via `update`, and publishes `minigame.resolved`
 * when `play` returns an outcome.
 */
export function createMechanicSystem(spec: MechanicSpec): System {
  let unsubscribes: (() => void)[] = [];
  let descriptor: EntityId | null = null;
  /** The session this mechanic entered, kept for the exit hook's payload. */
  let entered: MinigameSession | null = null;
  return {
    id: spec.mechanicId,
    dependencies: ['minigame-host', ...(spec.dependencies ?? [])],
    init(context: SystemContext): void {
      descriptor = context.world.createEntity();
      context.world.addComponent(descriptor, MECHANIC_TYPE, { mechanicId: spec.mechanicId });
      unsubscribes.push(
        context.events.subscribe(MINIGAME_STARTED, (event) => {
          if (event.payload.mechanicId !== spec.mechanicId) return;
          const session = activeMinigameSession(context);
          if (session === null || session.mechanicId !== spec.mechanicId) return;
          entered = session;
          spec.enter?.(session, context);
        }),
        context.events.subscribe(MINIGAME_ENDED, (event) => {
          if (event.payload.mechanicId !== spec.mechanicId || entered === null) return;
          const session = entered;
          entered = null;
          spec.exit?.({ session, outcome: event.payload.outcome }, context);
        }),
      );
    },
    update(dt: number, context: SystemContext): void {
      const session = activeMinigameSession(context);
      if (session === null || session.mechanicId !== spec.mechanicId) return;
      const outcome = spec.play?.(dt, session, context) ?? null;
      if (outcome === null) return;
      context.events.publish(MINIGAME_RESOLVED, {
        questId: session.questId,
        objectiveId: session.objectiveId,
        outcome,
      });
    },
    teardown(context: SystemContext): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      entered = null;
      if (descriptor !== null) {
        context.world.removeComponent(descriptor, MECHANIC_TYPE);
        descriptor = null;
      }
    },
  };
}

/**
 * The host plugin: the System plus the component and event types the
 * framework introduces, registered and removed as one unit (FR-ARCH-018).
 */
export function createMinigameHostPlugin(): Plugin {
  return {
    id: 'plugin.minigame-host',
    systems: [createMinigameHostSystem()],
    componentTypes: [METAPHOR, MECHANIC_TYPE, MINIGAME_SESSION],
    eventTypes: [MINIGAME_LAUNCH_REQUESTED, MINIGAME_STARTED, MINIGAME_RESOLVED, MINIGAME_ENDED],
  };
}

/**
 * Bundle a mechanic spec as a registrable plugin. The hard dependency on
 * the host means a mechanic loaded without it fails loudly and safely
 * (FR-ARCH-020) instead of playing into the void.
 */
export function createMechanicPlugin(spec: MechanicSpec): Plugin {
  return {
    id: `plugin.${spec.mechanicId}`,
    dependencies: ['plugin.minigame-host'],
    systems: [createMechanicSystem(spec)],
  };
}
