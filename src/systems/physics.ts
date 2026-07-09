/**
 * Physics and Collision System — colliders, broadphase, swept resolution
 * against solid world geometry, and trigger volumes (issue #20; spec:
 * docs/31-Physics-and-Collision.md).
 *
 * Runs after Movement each fixed step as the constraint pass docs/15
 * anticipates: Movement integrates position in free space; this System
 * consumes Collider + Position, sweeps each moving collider from where the
 * step started to where Movement put it, and clamps disallowed motion at
 * the first blocking face — whole-segment sweeps, so no speed tunnels
 * through a solid (FR-PHY-004). The velocity component pressed into a
 * contact is zeroed on the MOTION slice; `moving`/facing stay Movement's
 * judgment of intent-driven motion, so pressing against a wall does not
 * flap start/stop events (FR-PHY-005).
 *
 * Contact and trigger-occupancy history live in world-state components this
 * System owns (FR-ARCH-014/015) — plain serializable data, never private
 * shadow state — and every begin/end transition is announced as a deferred
 * event (FR-ARCH-012). Broadphase is a uniform grid rebuilt per
 * step from world state: deterministic, and never a stale shadow copy.
 *
 * Determinism (NFR-ARCH-001): update is pure with respect to (world state,
 * dt); candidate sets are gathered in ascending entity order; only
 * IEEE-exact arithmetic. No wall clock, no randomness (FR-ARCH-025).
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { MOTION, POSITION } from './scene';

/**
 * An axis-aligned collision box centered on the entity's POSITION, in
 * logical units. `solid` boxes block and are blocked; `trigger` boxes never
 * block — they announce enter/exit as movers overlap them.
 */
export type Collider = {
  readonly width: number;
  readonly height: number;
  readonly mode: 'solid' | 'trigger';
};
export const COLLIDER = defineComponentType<Collider>('collider');

/**
 * The solids a moving collider is currently blocked by, ascending entity
 * id — the physics-owned history that turns per-step blocking into
 * begin/end transitions, kept in world state so it serializes with the
 * world (FR-ARCH-014).
 */
export type CollisionContacts = { readonly solids: readonly number[] };
export const COLLISION_CONTACTS = defineComponentType<CollisionContacts>('collision-contacts');

/**
 * The movers currently inside a trigger volume, ascending entity id —
 * physics-owned occupancy on the trigger entity, the serializable "who is
 * in this interaction volume" consumers may also read directly.
 */
export type TriggerOccupancy = { readonly occupants: readonly number[] };
export const TRIGGER_OCCUPANCY = defineComponentType<TriggerOccupancy>('trigger-occupancy');

/** A mover began / stopped being blocked by a solid (deferred, FR-ARCH-012). */
export const COLLISION_STARTED = defineEventType<{
  readonly entityId: number;
  readonly otherId: number;
}>('collision.started');
export const COLLISION_ENDED = defineEventType<{
  readonly entityId: number;
  readonly otherId: number;
}>('collision.ended');

/** A mover entered / left a trigger volume (deferred, FR-ARCH-012). */
export const TRIGGER_ENTERED = defineEventType<{
  readonly entityId: number;
  readonly triggerId: number;
}>('trigger.entered');
export const TRIGGER_EXITED = defineEventType<{
  readonly entityId: number;
  readonly triggerId: number;
}>('trigger.exited');

/** Broadphase grid cell size in logical units (tuned for marker-scale boxes). */
export const BROADPHASE_CELL = 32;

/** An axis-aligned box, min/max corners in logical units. */
export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The collider's box centered on the entity's position. */
export function colliderBox(
  position: { readonly x: number; readonly y: number },
  collider: { readonly width: number; readonly height: number },
): Box {
  const halfW = collider.width / 2;
  const halfH = collider.height / 2;
  return {
    minX: position.x - halfW,
    minY: position.y - halfH,
    maxX: position.x + halfW,
    maxY: position.y + halfH,
  };
}

/** Strict overlap: boxes merely touching at a face or corner do not collide. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

export interface Broadphase {
  /** Candidate entity ids whose boxes may intersect the area, ascending. */
  query(area: Box): EntityId[];
}

/**
 * Uniform-grid broadphase (the deliverable's narrowing pass): each box lands
 * in every cell it overlaps; a query unions the cells the area overlaps.
 * Purely derived from its inputs, rebuilt per step — deterministic and never
 * stale (FR-ARCH-014).
 */
export function buildBroadphase(entries: readonly (readonly [EntityId, Box])[]): Broadphase {
  const cells = new Map<string, EntityId[]>();
  const cellSpan = (min: number, max: number): [number, number] => [
    Math.floor(min / BROADPHASE_CELL),
    Math.floor(max / BROADPHASE_CELL),
  ];
  for (const [id, box] of entries) {
    const [x0, x1] = cellSpan(box.minX, box.maxX);
    const [y0, y1] = cellSpan(box.minY, box.maxY);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = `${cx},${cy}`;
        const cell = cells.get(key);
        if (cell === undefined) cells.set(key, [id]);
        else cell.push(id);
      }
    }
  }
  return {
    query(area: Box): EntityId[] {
      const [x0, x1] = cellSpan(area.minX, area.maxX);
      const [y0, y1] = cellSpan(area.minY, area.maxY);
      const found = new Set<EntityId>();
      for (let cx = x0; cx <= x1; cx += 1) {
        for (let cy = y0; cy <= y1; cy += 1) {
          for (const id of cells.get(`${cx},${cy}`) ?? []) found.add(id);
        }
      }
      return [...found].sort((a, b) => a - b);
    },
  };
}

interface SolidView {
  readonly id: EntityId;
  readonly box: Box;
}

/**
 * Sweep one axis of a mover's step: from `from` to `to` with half-extent
 * `half`, cross-axis interval (`crossMin`, `crossMax`), against candidate
 * faces. Returns where the mover stops and the first solid that blocked it.
 * Checking the whole travel segment — not just the endpoint — is what makes
 * resolution tunnel-proof at any per-step displacement (FR-PHY-004).
 */
function sweepAxis(
  from: number,
  to: number,
  half: number,
  crossMin: number,
  crossMax: number,
  candidates: readonly SolidView[],
  axis: 'x' | 'y',
): { stop: number; blocker: EntityId | null } {
  if (to === from) return { stop: to, blocker: null };
  let stop = to;
  let blocker: EntityId | null = null;
  for (const candidate of candidates) {
    const box = candidate.box;
    const candCrossMin = axis === 'x' ? box.minY : box.minX;
    const candCrossMax = axis === 'x' ? box.maxY : box.maxX;
    if (candCrossMax <= crossMin || candCrossMin >= crossMax) continue;
    if (to > from) {
      const face = (axis === 'x' ? box.minX : box.minY) - half;
      if (from <= face && face < stop) {
        stop = face;
        blocker = candidate.id;
      }
    } else {
      const face = (axis === 'x' ? box.maxX : box.maxY) + half;
      if (from >= face && face > stop) {
        stop = face;
        blocker = candidate.id;
      }
    }
  }
  return { stop, blocker };
}

/** Ascending-id diff of two sorted membership lists → begin/end transitions. */
function diffMembership(
  previous: readonly number[],
  next: readonly number[],
): { began: number[]; ended: number[] } {
  return {
    began: next.filter((id) => !previous.includes(id)),
    ended: previous.filter((id) => !next.includes(id)),
  };
}

/** Same members in the same order — membership lists are kept sorted. */
function sameMembers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

interface MoverView {
  readonly id: EntityId;
  readonly box: Box;
}

/** Read every collider into solid/trigger views, in store order. */
function gatherColliders(world: EntityStore): { solids: SolidView[]; triggers: SolidView[] } {
  const solids: SolidView[] = [];
  const triggers: SolidView[] = [];
  for (const entity of world.query(POSITION, COLLIDER)) {
    const position = world.getComponent(entity, POSITION);
    const collider = world.getComponent(entity, COLLIDER);
    if (position === undefined || collider === undefined) continue;
    const view = { id: entity, box: colliderBox(position, collider) };
    if (collider.mode === 'solid') solids.push(view);
    else triggers.push(view);
  }
  return { solids, triggers };
}

export const physicsSystem: System = {
  id: 'physics',
  // Ordering only: constrain the position Movement integrated this step.
  dependencies: ['movement'],
  init() {},
  update(dt: number, context: SystemContext): void {
    const world = context.world;
    const { solids, triggers } = gatherColliders(world);
    const grid = buildBroadphase(solids.map((solid) => [solid.id, solid.box]));
    const solidById = new Map(solids.map((solid) => [solid.id, solid]));
    const movers: MoverView[] = [];

    // Resolve each moving solid collider in store order (deterministic).
    for (const entity of world.query(POSITION, COLLIDER, MOTION)) {
      const collider = world.getComponent(entity, COLLIDER);
      const position = world.getComponent(entity, POSITION);
      const motion = world.getComponent(entity, MOTION);
      if (collider === undefined || position === undefined || motion === undefined) continue;
      if (collider.mode !== 'solid') continue;
      const halfW = collider.width / 2;
      const halfH = collider.height / 2;
      let velocityX = motion.velocityX;
      let velocityY = motion.velocityY;

      // Where the step started: Movement integrates semi-implicitly, so the
      // step's travel is exactly velocity · dt (the world-bounds clamp can
      // shorten it; the depenetration backstop below covers that sliver).
      const fromX = position.x - velocityX * dt;
      const fromY = position.y - velocityY * dt;

      // Broadphase over the whole swept area, self excluded.
      const area: Box = {
        minX: Math.min(fromX, position.x) - halfW,
        minY: Math.min(fromY, position.y) - halfH,
        maxX: Math.max(fromX, position.x) + halfW,
        maxY: Math.max(fromY, position.y) + halfH,
      };
      const candidates = grid
        .query(area)
        .filter((id) => id !== entity)
        .map((id) => solidById.get(id) as SolidView);

      // Narrowphase: axis-separated sweeps (x then y — the documented stable
      // order), so sliding along a wall preserves the tangential component.
      const blockers: number[] = [];
      const sweptX = sweepAxis(
        fromX,
        position.x,
        halfW,
        fromY - halfH,
        fromY + halfH,
        candidates,
        'x',
      );
      let x = sweptX.stop;
      if (sweptX.blocker !== null) {
        velocityX = 0;
        blockers.push(sweptX.blocker);
      }
      const sweptY = sweepAxis(fromY, position.y, halfH, x - halfW, x + halfW, candidates, 'y');
      let y = sweptY.stop;
      if (sweptY.blocker !== null) {
        velocityY = 0;
        blockers.push(sweptY.blocker);
      }

      // Depenetration backstop: a mover that still overlaps a solid (spawned
      // inside it, restored from a save, or clipped by the bounds clamp) is
      // pushed out along the smaller penetration axis, ties broken toward x —
      // deterministic, and it guarantees a step never ends inside a solid.
      for (const candidate of candidates) {
        const box: Box = { minX: x - halfW, minY: y - halfH, maxX: x + halfW, maxY: y + halfH };
        if (!boxesOverlap(box, candidate.box)) continue;
        const pushX =
          x >= (candidate.box.minX + candidate.box.maxX) / 2
            ? candidate.box.maxX + halfW - x
            : candidate.box.minX - halfW - x;
        const pushY =
          y >= (candidate.box.minY + candidate.box.maxY) / 2
            ? candidate.box.maxY + halfH - y
            : candidate.box.minY - halfH - y;
        if (Math.abs(pushX) <= Math.abs(pushY)) {
          x += pushX;
          velocityX = 0;
        } else {
          y += pushY;
          velocityY = 0;
        }
        blockers.push(candidate.id);
      }

      if (x !== position.x || y !== position.y) {
        world.addComponent(entity, POSITION, { x, y });
      }
      // Constrain velocity only: `moving` and facing remain Movement's
      // judgment of intent-driven motion, so pressing against a wall keeps a
      // stable "pushing" state instead of flapping start/stop events.
      if (velocityX !== motion.velocityX || velocityY !== motion.velocityY) {
        world.addComponent(entity, MOTION, { ...motion, velocityX, velocityY });
      }

      // Blocking history → begin/end transition events, ascending ids.
      const contacts = [...new Set(blockers)].sort((a, b) => a - b);
      const previous = world.getComponent(entity, COLLISION_CONTACTS)?.solids ?? [];
      if (!sameMembers(previous, contacts)) {
        const { began, ended } = diffMembership(previous, contacts);
        for (const otherId of began) {
          context.events.publish(COLLISION_STARTED, { entityId: entity, otherId });
        }
        for (const otherId of ended) {
          context.events.publish(COLLISION_ENDED, { entityId: entity, otherId });
        }
        if (contacts.length > 0) {
          world.addComponent(entity, COLLISION_CONTACTS, { solids: contacts });
        } else {
          world.removeComponent(entity, COLLISION_CONTACTS);
        }
      }

      const resolved: MoverView = {
        id: entity,
        box: { minX: x - halfW, minY: y - halfH, maxX: x + halfW, maxY: y + halfH },
      };
      movers.push(resolved);
      // Later movers must collide with where this one actually ended up,
      // not its start-of-pass snapshot (the grid's cells stay conservative).
      solidById.set(entity, resolved);
    }

    // Trigger volumes: occupancy from resolved mover boxes, enter/exit on
    // the difference — exactly once per actual transition (FR-PHY-006).
    for (const trigger of triggers) {
      const occupants = movers
        .filter((mover) => mover.id !== trigger.id && boxesOverlap(mover.box, trigger.box))
        .map((mover) => mover.id as number)
        .sort((a, b) => a - b);
      const previous = world.getComponent(trigger.id, TRIGGER_OCCUPANCY)?.occupants ?? [];
      if (sameMembers(previous, occupants)) continue;
      const { began, ended } = diffMembership(previous, occupants);
      for (const entityId of began) {
        context.events.publish(TRIGGER_ENTERED, { entityId, triggerId: trigger.id });
      }
      for (const entityId of ended) {
        context.events.publish(TRIGGER_EXITED, { entityId, triggerId: trigger.id });
      }
      if (occupants.length > 0) {
        world.addComponent(trigger.id, TRIGGER_OCCUPANCY, { occupants });
      } else {
        world.removeComponent(trigger.id, TRIGGER_OCCUPANCY);
      }
    }
  },
  teardown() {},
};

/**
 * The physics plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018).
 */
export const physicsPlugin: Plugin = {
  id: 'plugin.physics',
  systems: [physicsSystem],
  componentTypes: [COLLIDER, COLLISION_CONTACTS, TRIGGER_OCCUPANCY],
  eventTypes: [COLLISION_STARTED, COLLISION_ENDED, TRIGGER_ENTERED, TRIGGER_EXITED],
};
