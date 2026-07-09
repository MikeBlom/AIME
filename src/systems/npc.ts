/**
 * NPC and Behavior System — data-driven character routines and the
 * interaction affordance that starts dialogue (issue #27; spec:
 * docs/22-NPC-and-Behavior.md).
 *
 * Characters spawn from `npc` content documents carrying an immutable NPC
 * definition: an optional dialogue reference and a routine — one entry per
 * time-of-day phase, each optionally carrying waypoints and a speed. The
 * System composes three primitive behaviors from that data (FR-NPC-002):
 * no waypoints = idle, one = move-to, several = a repeating patrol loop.
 * The active entry is selected by the phase tracked from the shared
 * `time.phase-changed` event (FR-NPC-003/004); before any phase is
 * announced the first entry applies, so a world without a day/night System
 * still has walking characters (FR-ARCH-008).
 *
 * For character entities this System is the Motion writer (FR-ARCH-015) —
 * the Movement System acts only on player-controlled entities — so
 * animation and camera consumers observe NPC motion exactly as they
 * observe the player's, and the physics pass constrains it against solids
 * the same way (FR-NPC-005/006). Walking is constant-speed straight-line
 * waypoint segments: a step that would overshoot lands exactly on the
 * waypoint — simple, exact, reproducible.
 *
 * Interaction: on the Input System's `intent.interact`, when the UI slice
 * is not modal (FR-NPC-008), the nearest character within the shared
 * interaction radius is announced as `npc.interacted`, and a declared
 * `dialogueRef` publishes the Dialogue System's `dialogue.start.requested`
 * (FR-NPC-007) — deferred, so the same press can never both open and
 * advance a conversation (FR-NPC-009).
 *
 * Determinism (NFR-NPC-001): update is pure with respect to (world state,
 * dt, buffered events); characters iterate in ascending entity order; only
 * IEEE-exact arithmetic plus `Math.sqrt`. No wall clock, no randomness.
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { TIME_PHASE_CHANGED } from './audio';
import { DIALOGUE_START_REQUESTED } from './dialogue';
import { INTENT_INTERACT } from './input';
import type { Motion, Position } from './scene';
import { IDLE_MOTION, LOGICAL_SPACE, MOTION, PLAYER_CONTROLLED, POSITION } from './scene';
import { PROMPT_RADIUS, UI_STATE } from './ui';

/**
 * One routine entry: which time-of-day phase it covers, the waypoints the
 * behavior walks (none = idle, one = move-to, several = patrol), and an
 * optional speed override. Authoring notes (`activity`) never reach here —
 * the composition root translates content documents into this shape.
 */
export type NpcRoutineEntry = {
  readonly phase: string;
  readonly waypoints: readonly Position[];
  readonly speed: number | null;
};

/** An NPC as spawned from its content document. Data only (FR-NPC-001). */
export type NpcDefinition = {
  readonly npcId: string;
  readonly dialogueRef: string | null;
  readonly routine: readonly NpcRoutineEntry[];
};
export const NPC = defineComponentType<NpcDefinition>('npc');

/**
 * The System-owned behavior slice per character (FR-NPC-010): the phase
 * last announced (null until the world clock speaks) and progress through
 * the active entry's waypoint sequence. Plain serializable data.
 */
export type NpcBehavior = {
  readonly phase: string | null;
  readonly waypointIndex: number;
};
export const NPC_BEHAVIOR = defineComponentType<NpcBehavior>('npc-behavior');

export const IDLE_NPC_BEHAVIOR: NpcBehavior = { phase: null, waypointIndex: 0 };

/**
 * An interact press landed on a character (FR-NPC-007): which entity,
 * which content id, and the dialogue it opens (null when it has none).
 * Quests, achievements, and analytics consume this without knowing NPCs.
 */
export const NPC_INTERACTED = defineEventType<{
  readonly entityId: number;
  readonly npcId: string;
  readonly dialogueId: string | null;
}>('npc.interacted');

/** Default walking speed in logical units per second; content overrides. */
export const DEFAULT_NPC_SPEED = 24;

/** Interaction range: the UI System's prompt radius, shared vocabulary so
 * "a prompt shows" and "interact works" can never disagree. */
export const NPC_INTERACT_RADIUS = PROMPT_RADIUS;

/** Within this many logical units a waypoint counts as reached. */
const WAYPOINT_EPSILON = 0.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The entry covering this phase; the first entry when nothing matches. */
export function activeRoutineEntry(
  routine: readonly NpcRoutineEntry[],
  phase: string | null,
): NpcRoutineEntry | null {
  if (routine.length === 0) return null;
  return routine.find((entry) => entry.phase === phase) ?? routine[0] ?? null;
}

/** The world's UI slice modal flag; false when no UI System owns one. */
function uiIsModal(world: EntityStore): boolean {
  for (const entity of world.query(UI_STATE)) {
    const state = world.getComponent(entity, UI_STATE);
    if (state !== undefined) return state.modal;
  }
  return false;
}

/** The player's position, from the first player-controlled entity. */
function playerPosition(world: EntityStore): Position | null {
  for (const entity of world.query(PLAYER_CONTROLLED, POSITION)) {
    const position = world.getComponent(entity, POSITION);
    if (position !== undefined) return position;
  }
  return null;
}

/**
 * Build the NPC and Behavior System. A factory because the System buffers
 * bus events between flush and update and holds its subscriptions; each
 * booted world composes a fresh instance (hot-reload safe).
 */
export function createNpcSystem(): System {
  let pendingInteract = false;
  let pendingPhase: string | null = null;
  let unsubscribes: (() => void)[] = [];

  const reset = () => {
    pendingInteract = false;
    pendingPhase = null;
  };

  /** The character's behavior slice, spawned idle on first touch. */
  const behaviorOf = (world: EntityStore, entity: EntityId): NpcBehavior => {
    const existing = world.getComponent(entity, NPC_BEHAVIOR);
    if (existing !== undefined) return existing;
    world.addComponent(entity, NPC_BEHAVIOR, IDLE_NPC_BEHAVIOR);
    return IDLE_NPC_BEHAVIOR;
  };

  // Character motion is exposed through the MOTION slice only. The shared
  // movement start/stop events stay player vocabulary — they pace autosave
  // and audio cues — so ambient walkers never fire them (FR-NPC-006).
  const writeMotion = (context: SystemContext, entity: EntityId, next: Motion): void => {
    const current = context.world.getComponent(entity, MOTION) ?? IDLE_MOTION;
    if (
      next.moving !== current.moving ||
      next.velocityX !== current.velocityX ||
      next.velocityY !== current.velocityY ||
      next.facingX !== current.facingX ||
      next.facingY !== current.facingY
    ) {
      context.world.addComponent(entity, MOTION, next);
    }
  };

  /** Rest in place, holding the last facing (idle / arrived / no routine). */
  const rest = (context: SystemContext, entity: EntityId): void => {
    const current = context.world.getComponent(entity, MOTION) ?? IDLE_MOTION;
    writeMotion(context, entity, {
      moving: false,
      velocityX: 0,
      velocityY: 0,
      facingX: current.facingX,
      facingY: current.facingY,
    });
  };

  /** One fixed-step walk along the active entry's waypoint sequence. */
  const walk = (
    context: SystemContext,
    entity: EntityId,
    dt: number,
    entry: NpcRoutineEntry,
    behavior: NpcBehavior,
  ): void => {
    const world = context.world;
    const position = world.getComponent(entity, POSITION);
    if (position === undefined) return;
    const count = entry.waypoints.length;
    // A stale index (phase switch, content change) wraps deterministically.
    const index = count > 0 ? behavior.waypointIndex % count : 0;
    const target = entry.waypoints[index];
    if (target === undefined) {
      rest(context, entity);
      return;
    }

    const dx = target.x - position.x;
    const dy = target.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= WAYPOINT_EPSILON) {
      // Arrived: a patrol advances to the next waypoint (walked next step);
      // a move-to entry stays put. Either way this step is at rest.
      const nextIndex = count > 1 ? (index + 1) % count : index;
      if (nextIndex !== behavior.waypointIndex || behavior.waypointIndex !== index) {
        world.addComponent(entity, NPC_BEHAVIOR, { ...behavior, waypointIndex: nextIndex });
      }
      rest(context, entity);
      return;
    }

    const speed = entry.speed ?? DEFAULT_NPC_SPEED;
    const step = speed * dt;
    const directionX = dx / distance;
    const directionY = dy / distance;
    // A step that would overshoot lands exactly on the waypoint — exact
    // and reproducible (NFR-NPC-001); the index advances on arrival above.
    const rawX = step >= distance ? target.x : position.x + directionX * step;
    const rawY = step >= distance ? target.y : position.y + directionY * step;
    const nextX = clamp(rawX, 0, LOGICAL_SPACE.width);
    const nextY = clamp(rawY, 0, LOGICAL_SPACE.height);
    if (nextX !== position.x || nextY !== position.y) {
      world.addComponent(entity, POSITION, { x: nextX, y: nextY });
    }
    writeMotion(context, entity, {
      moving: true,
      velocityX: directionX * speed,
      velocityY: directionY * speed,
      facingX: directionX,
      facingY: directionY,
    });
  };

  /** Route a buffered interact press to the nearest character in range. */
  const interact = (context: SystemContext): void => {
    const world = context.world;
    if (uiIsModal(world)) return; // the surface owns the press (FR-NPC-008)
    const player = playerPosition(world);
    if (player === null) return;

    let nearest: EntityId | null = null;
    let nearestDistanceSq = NPC_INTERACT_RADIUS * NPC_INTERACT_RADIUS;
    // Ascending entity order makes the tie-break deterministic: the first
    // strictly-nearer character wins, equal distance keeps the lower id.
    for (const entity of world.query(NPC, POSITION)) {
      const position = world.getComponent(entity, POSITION);
      if (position === undefined) continue;
      const dx = position.x - player.x;
      const dy = position.y - player.y;
      const distanceSq = dx * dx + dy * dy;
      if (
        distanceSq < nearestDistanceSq ||
        (distanceSq === nearestDistanceSq && nearest === null)
      ) {
        nearest = entity;
        nearestDistanceSq = distanceSq;
      }
    }
    if (nearest === null) return;
    const definition = world.getComponent(nearest, NPC);
    if (definition === undefined) return;

    context.events.publish(NPC_INTERACTED, {
      entityId: nearest,
      npcId: definition.npcId,
      dialogueId: definition.dialogueRef,
    });
    if (definition.dialogueRef !== null) {
      context.events.publish(DIALOGUE_START_REQUESTED, { dialogueId: definition.dialogueRef });
    }
  };

  return {
    id: 'npc',
    // Ordering only: run after Movement resolved the player's step, before
    // the physics pass sweeps this step's character motion. A world without
    // Movement still walks its characters (FR-ARCH-008).
    dependencies: ['movement'],
    init(context: SystemContext): void {
      reset();
      unsubscribes.push(
        context.events.subscribe(INTENT_INTERACT, () => {
          pendingInteract = true;
        }),
      );
      unsubscribes.push(
        context.events.subscribe(TIME_PHASE_CHANGED, (event) => {
          if (typeof event.payload.phase === 'string') pendingPhase = event.payload.phase;
        }),
      );
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      const characters = world.query(NPC, POSITION);

      // A phase change re-selects every character's active entry and
      // restarts its waypoint sequence (FR-NPC-004).
      if (pendingPhase !== null) {
        for (const entity of characters) {
          world.addComponent(entity, NPC_BEHAVIOR, { phase: pendingPhase, waypointIndex: 0 });
        }
        pendingPhase = null;
      }

      for (const entity of characters) {
        const definition = world.getComponent(entity, NPC);
        if (definition === undefined) continue;
        const behavior = behaviorOf(world, entity);
        const entry = activeRoutineEntry(definition.routine, behavior.phase);
        if (entry === null || entry.waypoints.length === 0) {
          rest(context, entity); // idle behavior (FR-NPC-002)
          continue;
        }
        walk(context, entity, dt, entry, behavior);
      }

      if (pendingInteract) {
        interact(context);
        pendingInteract = false;
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
 * The NPC plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createNpcPlugin(): Plugin {
  return {
    id: 'plugin.npc',
    systems: [createNpcSystem()],
    componentTypes: [NPC, NPC_BEHAVIOR],
    eventTypes: [NPC_INTERACTED],
  };
}
