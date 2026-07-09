/**
 * Buildings and Interiors System — content-defined structures the player
 * enters and leaves through doorways (issue #30; spec:
 * docs/25-Buildings-and-Interiors.md).
 *
 * A building marker whose content document declares an `interior` gets a
 * doorway trigger at its south face (FR-BLD-002); the physics System's
 * trigger occupancy says who stands on it, and this System runs the enter
 * transition: fade out, swap the player into the interior space at its
 * content-declared spawn point, fade in (FR-BLD-003/004). Occupancy state,
 * not event edges, drives the start, so a doorway reached while a fade is
 * still finishing is honored the moment the world is idle again. The
 * interior — perimeter walls, content-declared colliders, interaction
 * points, and the exit doorway — spawns on first entry (and on resume into
 * a saved interior), every piece tagged with the interior's space id so
 * collision, prompts, and drawing relate only same-space entities
 * (FR-BLD-005..007). Walking onto the exit doorway runs the reverse
 * transition back to the remembered exterior position (FR-BLD-004).
 *
 * Occupancy is world state: each entity's SPACE component says which space
 * it inhabits, and the ACTIVE_SPACE slice this System owns (FR-ARCH-015)
 * carries the presented space, the running transition, the exterior return
 * position, and the doorway re-arm gate. All of it is plain serializable
 * data, so a session saved indoors resumes indoors (FR-BLD-008).
 *
 * Interaction points are the interior's diegetic detail hooks (FR-BLD-007):
 * standing near one publishes the UI hint with its content-declared locale
 * key; stepping away clears it. The engine names no career fact — every
 * label, size, and layout arrives from the pack (DATA-FR-027).
 *
 * Determinism (NFR-ARCH-001): update is pure with respect to (world state,
 * dt); entities iterate in ascending id order; no wall clock, no
 * randomness (FR-ARCH-025).
 */
import type { ComponentData, EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { COLLIDER, TRIGGER_OCCUPANCY } from './physics';
import type { ActiveSpace } from './scene';
import {
  ACTIVE_SPACE,
  IDLE_MOTION,
  LOGICAL_SPACE,
  MOTION,
  PLAYER_CONTROLLED,
  POSITION,
  RENDERABLE,
  SPACE,
  SPACE_EXTERIOR,
  spaceOf,
} from './scene';
import { PROMPT_RADIUS, UI_HINT } from './ui';

/** A rectangle in room-local units, positioned by its center. */
export type InteriorRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** An interior detail hook: a spot that raises a content-keyed hint. */
export type InteriorPoint = {
  readonly pointId: string;
  readonly hintKey: string;
  readonly x: number;
  readonly y: number;
};

/**
 * A building's interior as declared by its content document: the room's
 * size, the player spawn point, solid furnishing colliders, and interaction
 * points — all in room-local units, the room centered in the logical space.
 */
export type InteriorDefinition = {
  readonly width: number;
  readonly height: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly colliders: readonly InteriorRect[];
  readonly points: readonly InteriorPoint[];
};

/**
 * A building as spawned from its content document. Data only; a null
 * interior means the building is set dressing and gets no doorway.
 */
export type BuildingDefinition = {
  readonly buildingId: string;
  readonly interior: InteriorDefinition | null;
};
export const BUILDING = defineComponentType<BuildingDefinition>('building');

/** A doorway trigger: which building it serves and which way it leads. */
export type Doorway = { readonly buildingId: string; readonly role: 'entry' | 'exit' };
export const DOORWAY = defineComponentType<Doorway>('doorway');

/** An interior interaction point entity (FR-BLD-007). */
export type InteractionPoint = { readonly pointId: string; readonly hintKey: string };
export const INTERACTION_POINT = defineComponentType<InteractionPoint>('interaction-point');

/** The player finished entering / leaving a building (deferred). */
export const BUILDING_ENTERED = defineEventType<{
  readonly buildingId: string;
  readonly entityId: number;
}>('building.entered');
export const BUILDING_EXITED = defineEventType<{
  readonly buildingId: string;
  readonly entityId: number;
}>('building.exited');

/** Enter/exit fade length in seconds; the swap lands at the midpoint. */
export const TRANSITION_SECONDS = 0.6;

/** Engine geometry defaults, in logical units. Room layout is content. */
export const WALL_THICKNESS = 4;
export const DOORWAY_SIZE = { width: 12, height: 6 } as const;
const POINT_SIZE = { width: 6, height: 6 } as const;
const DEFAULT_INTERIOR_SIZE = { width: 160, height: 110 } as const;
/** Clear of the exit doorway so a fresh spawn never lands on it. */
const SPAWN_DOOR_CLEARANCE = 10;

const IDLE_ACTIVE_SPACE: ActiveSpace = {
  space: SPACE_EXTERIOR,
  transition: null,
  returnX: null,
  returnY: null,
  armed: true,
};

function asRecord(value: ComponentData | undefined): Readonly<Record<string, ComponentData>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, ComponentData>>;
}

const finite = (value: ComponentData | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Translate a building document's `interior` block into the engine's
 * definition (the seam crossing, like the NPC routine translation): sizes
 * clamp into the logical space, malformed entries drop, missing spawn
 * defaults to bottom-center clear of the exit doorway (FR-ARCH-008).
 */
export function readInterior(value: ComponentData | undefined): InteriorDefinition | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, ComponentData>>;
  const size = asRecord(record['size']);
  const width = Math.min(finite(size['width']) ?? DEFAULT_INTERIOR_SIZE.width, LOGICAL_SPACE.width);
  const height = Math.min(
    finite(size['height']) ?? DEFAULT_INTERIOR_SIZE.height,
    LOGICAL_SPACE.height,
  );
  const spawn = asRecord(record['spawn']);
  const spawnX = finite(spawn['x']) ?? width / 2;
  const spawnY =
    finite(spawn['y']) ?? height - WALL_THICKNESS - DOORWAY_SIZE.height - SPAWN_DOOR_CLEARANCE;
  const colliders = (Array.isArray(record['colliders']) ? record['colliders'] : [])
    .map((entry) => asRecord(entry))
    .filter(
      (entry) =>
        finite(entry['x']) !== null &&
        finite(entry['y']) !== null &&
        finite(entry['width']) !== null &&
        finite(entry['height']) !== null,
    )
    .map((entry) => ({
      x: entry['x'] as number,
      y: entry['y'] as number,
      width: entry['width'] as number,
      height: entry['height'] as number,
    }));
  const points = (Array.isArray(record['points']) ? record['points'] : [])
    .map((entry) => asRecord(entry))
    .filter(
      (entry) =>
        typeof entry['id'] === 'string' &&
        typeof entry['hintKey'] === 'string' &&
        finite(entry['x']) !== null &&
        finite(entry['y']) !== null,
    )
    .map((entry) => ({
      pointId: entry['id'] as string,
      hintKey: entry['hintKey'] as string,
      x: entry['x'] as number,
      y: entry['y'] as number,
    }));
  return { width, height, spawnX, spawnY, colliders, points };
}

/** The room's top-left corner: interiors center in the logical space. */
export function interiorOrigin(interior: InteriorDefinition): { x: number; y: number } {
  return {
    x: (LOGICAL_SPACE.width - interior.width) / 2,
    y: (LOGICAL_SPACE.height - interior.height) / 2,
  };
}

/** The interior player spawn point in logical units. */
export function interiorSpawn(interior: InteriorDefinition): { x: number; y: number } {
  const origin = interiorOrigin(interior);
  return { x: origin.x + interior.spawnX, y: origin.y + interior.spawnY };
}

/** The first player-controlled entity, the transition's subject. */
function playerOf(world: EntityStore): EntityId | null {
  for (const entity of world.query(PLAYER_CONTROLLED, POSITION)) return entity;
  return null;
}

/**
 * Build the Buildings and Interiors System. A factory because the System
 * tracks the slice entity it adopted and the last published hint; each
 * booted world composes a fresh instance (hot-reload safe).
 */
export function createBuildingSystem(): System {
  let lastHintKey: string | null = null;
  let sliceEntity: EntityId | null = null;

  const reset = () => {
    lastHintKey = null;
    sliceEntity = null;
  };

  const slice = (world: EntityStore): ActiveSpace => {
    if (sliceEntity === null) return IDLE_ACTIVE_SPACE;
    return world.getComponent(sliceEntity, ACTIVE_SPACE) ?? IDLE_ACTIVE_SPACE;
  };

  const writeSlice = (world: EntityStore, next: ActiveSpace): void => {
    if (sliceEntity !== null) world.addComponent(sliceEntity, ACTIVE_SPACE, next);
  };

  /** One solid, visible box of interior geometry. */
  const spawnSolid = (
    world: EntityStore,
    space: string,
    kind: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void => {
    const entity = world.createEntity();
    world.addComponent(entity, POSITION, { x, y });
    world.addComponent(entity, RENDERABLE, { kind, width, height });
    world.addComponent(entity, COLLIDER, { width, height, mode: 'solid' });
    world.addComponent(entity, SPACE, { space });
  };

  /**
   * Materialize a building's interior: perimeter walls, content colliders,
   * interaction points, and the exit doorway — every entity tagged with the
   * interior's space id, spawned in a fixed order so ids are deterministic
   * (DATA-FR-017). Runs once per interior; the geometry persists after exit.
   */
  const spawnInterior = (world: EntityStore, building: BuildingDefinition): void => {
    const interior = building.interior;
    if (interior === null) return;
    const space = building.buildingId;
    const { x: ox, y: oy } = interiorOrigin(interior);
    const { width, height } = interior;
    const t = WALL_THICKNESS;

    spawnSolid(world, space, 'wall', ox + width / 2, oy + t / 2, width, t);
    spawnSolid(world, space, 'wall', ox + width / 2, oy + height - t / 2, width, t);
    spawnSolid(world, space, 'wall', ox + t / 2, oy + height / 2, t, height - 2 * t);
    spawnSolid(world, space, 'wall', ox + width - t / 2, oy + height / 2, t, height - 2 * t);
    for (const box of interior.colliders) {
      spawnSolid(world, space, 'furnishing', ox + box.x, oy + box.y, box.width, box.height);
    }
    for (const point of interior.points) {
      const entity = world.createEntity();
      world.addComponent(entity, POSITION, { x: ox + point.x, y: oy + point.y });
      world.addComponent(entity, RENDERABLE, { kind: 'poi', ...POINT_SIZE });
      world.addComponent(entity, INTERACTION_POINT, {
        pointId: point.pointId,
        hintKey: point.hintKey,
      });
      world.addComponent(entity, SPACE, { space });
    }
    const exit = world.createEntity();
    world.addComponent(exit, POSITION, {
      x: ox + width / 2,
      y: oy + height - t - DOORWAY_SIZE.height / 2,
    });
    world.addComponent(exit, RENDERABLE, { kind: 'doorway', ...DOORWAY_SIZE });
    world.addComponent(exit, COLLIDER, { ...DOORWAY_SIZE, mode: 'trigger' });
    world.addComponent(exit, DOORWAY, { buildingId: building.buildingId, role: 'exit' });
    world.addComponent(exit, SPACE, { space });
  };

  /** Doorway entities by building id and role, one query pass. */
  const doorwayIndex = (world: EntityStore): Map<string, EntityId> => {
    const index = new Map<string, EntityId>();
    for (const entity of world.query(DOORWAY)) {
      const doorway = world.getComponent(entity, DOORWAY);
      if (doorway !== undefined) index.set(`${doorway.role}:${doorway.buildingId}`, entity);
    }
    return index;
  };

  /** The building definition whose id names this space, if any. */
  const buildingOf = (world: EntityStore, space: string): BuildingDefinition | null => {
    for (const entity of world.query(BUILDING)) {
      const building = world.getComponent(entity, BUILDING);
      if (building !== undefined && building.buildingId === space) return building;
    }
    return null;
  };

  /**
   * Complete the swap at the transition's midpoint (FR-BLD-003/004).
   * Returns the slice after the move, or null when the swap cannot happen
   * (no player, or the target building vanished) so the caller cancels.
   */
  const swap = (context: SystemContext, active: ActiveSpace, to: string): ActiveSpace | null => {
    const world = context.world;
    const player = playerOf(world);
    if (player === null) return null;
    const position = world.getComponent(player, POSITION);
    const motion = world.getComponent(player, MOTION);

    if (to === SPACE_EXTERIOR) {
      world.addComponent(player, SPACE, { space: SPACE_EXTERIOR });
      world.addComponent(player, POSITION, {
        x: active.returnX ?? LOGICAL_SPACE.width / 2,
        y: active.returnY ?? LOGICAL_SPACE.height / 2,
      });
      if (motion !== undefined) world.addComponent(player, MOTION, { ...IDLE_MOTION });
      context.events.publish(BUILDING_EXITED, { buildingId: active.space, entityId: player });
      return { ...active, space: to, returnX: null, returnY: null, armed: false };
    }

    const building = buildingOf(world, to);
    if (building === null || building.interior === null) return null;
    if (doorwayIndex(world).get(`exit:${to}`) === undefined) spawnInterior(world, building);
    world.addComponent(player, SPACE, { space: to });
    world.addComponent(player, POSITION, interiorSpawn(building.interior));
    if (motion !== undefined) world.addComponent(player, MOTION, { ...IDLE_MOTION });
    context.events.publish(BUILDING_ENTERED, { buildingId: to, entityId: player });
    return {
      ...active,
      space: to,
      returnX: position?.x ?? null,
      returnY: position?.y ?? null,
      armed: false,
    };
  };

  /** Publish the interaction-point hint on change (FR-BLD-007). */
  const updateHint = (context: SystemContext): void => {
    const world = context.world;
    const player = playerOf(world);
    let hintKey: string | null = null;
    if (player !== null) {
      const position = world.getComponent(player, POSITION);
      const playerSpace = spaceOf(world, player);
      if (position !== undefined) {
        let nearestSq = PROMPT_RADIUS * PROMPT_RADIUS;
        for (const entity of world.query(INTERACTION_POINT, POSITION)) {
          if (spaceOf(world, entity) !== playerSpace) continue;
          const at = world.getComponent(entity, POSITION);
          const point = world.getComponent(entity, INTERACTION_POINT);
          if (at === undefined || point === undefined) continue;
          const dx = at.x - position.x;
          const dy = at.y - position.y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq < nearestSq || (distanceSq === nearestSq && hintKey === null)) {
            nearestSq = distanceSq;
            hintKey = point.hintKey;
          }
        }
      }
    }
    if (hintKey !== lastHintKey) {
      context.events.publish(UI_HINT, { textKey: hintKey });
      lastHintKey = hintKey;
    }
  };

  return {
    id: 'building',
    // Ordering only: read the doorway occupancy the physics pass settled
    // this step. A world without physics never fires doorways but still
    // runs — the building stays set dressing (FR-ARCH-008).
    dependencies: ['physics'],
    init(context: SystemContext): void {
      reset();
      // The active-space slice: adopt an existing entity (hot re-init) or
      // spawn one at the exterior. This System is its sole writer.
      const existing = context.world.query(ACTIVE_SPACE)[0];
      if (existing === undefined) {
        sliceEntity = context.world.createEntity();
        context.world.addComponent(sliceEntity, ACTIVE_SPACE, IDLE_ACTIVE_SPACE);
      } else {
        sliceEntity = existing;
      }
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      let active = slice(world);
      const doorways = doorwayIndex(world);

      // Entry doorways for every enterable building, spawned once at the
      // marker's south face (FR-BLD-002); idempotent across updates.
      for (const entity of world.query(BUILDING, POSITION)) {
        const building = world.getComponent(entity, BUILDING);
        const position = world.getComponent(entity, POSITION);
        if (building === undefined || position === undefined) continue;
        if (building.interior === null) continue;
        if (doorways.get(`entry:${building.buildingId}`) !== undefined) continue;
        const marker = world.getComponent(entity, RENDERABLE);
        const doorway = world.createEntity();
        world.addComponent(doorway, POSITION, {
          x: position.x,
          y: position.y + (marker?.height ?? 0) / 2 + DOORWAY_SIZE.height / 2,
        });
        world.addComponent(doorway, RENDERABLE, { kind: 'doorway', ...DOORWAY_SIZE });
        world.addComponent(doorway, COLLIDER, { ...DOORWAY_SIZE, mode: 'trigger' });
        world.addComponent(doorway, DOORWAY, { buildingId: building.buildingId, role: 'entry' });
        doorways.set(`entry:${building.buildingId}`, doorway);
      }

      // Resume into a saved interior: the save restores the slice and the
      // player's space, but interiors spawn on demand — materialize the
      // active one when its geometry is missing (FR-BLD-008).
      if (active.space !== SPACE_EXTERIOR && doorways.get(`exit:${active.space}`) === undefined) {
        const building = buildingOf(world, active.space);
        if (building !== null) spawnInterior(world, building);
      }

      // Advance the running transition; the swap lands exactly once, at the
      // midpoint crossing, behind the fully faded cover (FR-BLD-003).
      if (active.transition !== null) {
        const { to, progress: previous } = active.transition;
        const progress = Math.min(1, previous + dt / TRANSITION_SECONDS);
        active = { ...active, transition: { to, progress } };
        if (previous < 0.5 && progress >= 0.5) {
          const swapped = swap(context, active, to);
          // A failed swap cancels: fade back in from where the player is.
          active = swapped !== null ? { ...swapped, transition: { to, progress } } : active;
        }
        if (progress >= 1) active = { ...active, transition: null };
        writeSlice(world, active);
      }

      // Re-arm doorways once the player has stepped clear of them, so the
      // exit landing spot (inside the entry doorway) never bounces the
      // player straight back (FR-BLD-004).
      if (!active.armed) {
        const player = playerOf(world);
        let occupied = false;
        for (const entity of world.query(DOORWAY, TRIGGER_OCCUPANCY)) {
          const occupancy = world.getComponent(entity, TRIGGER_OCCUPANCY);
          if (player !== null && occupancy !== undefined && occupancy.occupants.includes(player)) {
            occupied = true;
            break;
          }
        }
        if (!occupied) {
          active = { ...active, armed: true };
          writeSlice(world, active);
        }
      }

      // The player standing on an armed doorway starts the matching
      // transition — driven by the physics-owned occupancy state, in
      // ascending doorway order, so nothing is missed and nothing races.
      // Anything else on a doorway (an NPC on patrol) is ignored.
      if (active.transition === null && active.armed) {
        const player = playerOf(world);
        if (player !== null) {
          for (const entity of world.query(DOORWAY, TRIGGER_OCCUPANCY)) {
            const doorway = world.getComponent(entity, DOORWAY);
            const occupancy = world.getComponent(entity, TRIGGER_OCCUPANCY);
            if (doorway === undefined || occupancy === undefined) continue;
            if (!occupancy.occupants.includes(player)) continue;
            const to = doorway.role === 'entry' ? doorway.buildingId : SPACE_EXTERIOR;
            if (to === active.space) continue;
            active = { ...active, transition: { to, progress: 0 } };
            writeSlice(world, active);
            break;
          }
        }
      }

      updateHint(context);
    },
    teardown(): void {
      reset();
    },
  };
}

/**
 * The buildings plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createBuildingPlugin(): Plugin {
  return {
    id: 'plugin.building',
    systems: [createBuildingSystem()],
    componentTypes: [BUILDING, DOORWAY, INTERACTION_POINT],
    eventTypes: [BUILDING_ENTERED, BUILDING_EXITED],
  };
}
