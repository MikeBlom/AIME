/**
 * Scene vocabulary for the walking skeleton: the logical simulation space,
 * the component types entities compose from, and the event types the slice
 * announces. All of it is generic engine vocabulary — which region, which
 * markers, which colors mean what, all arrive from the content pack and the
 * presenter, never from here (DATA-FR-027).
 *
 * Simulation runs in a fixed logical space so world behavior is identical
 * on every viewport (FR-ARCH-025); the presenter scales logical units to
 * surface pixels, and input is normalized back into logical units before
 * the simulation ever sees it (FR-ARCH-023).
 */
import type { ComponentData, EntityId, EntityStore, Plugin } from '../core';
import { defineComponentType, defineEventType } from '../core';

/** The fixed logical simulation space, in logical units. */
export const LOGICAL_SPACE = { width: 320, height: 180 } as const;

/** An entity's center in logical units. */
export type Position = { readonly x: number; readonly y: number };
export const POSITION = defineComponentType<Position>('position');

/**
 * Marks the entity the player drives. `speed` is the top speed in logical
 * units per second; `acceleration`/`friction` (logical units per second
 * squared) tune how motion ramps up and coasts to rest — engine defaults
 * apply when absent, so tuning is world data, never code.
 */
export type PlayerControlled = {
  readonly speed: number;
  readonly acceleration?: number;
  readonly friction?: number;
};
export const PLAYER_CONTROLLED = defineComponentType<PlayerControlled>('player-controlled');

/**
 * Motion state owned by the movement System (FR-ARCH-015): whether the
 * entity is in motion, its velocity in logical units per second, and its
 * unit facing — held from the last motion so animation and camera
 * consumers always have a direction to point at.
 */
export type Motion = {
  readonly moving: boolean;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly facingX: number;
  readonly facingY: number;
};
export const MOTION = defineComponentType<Motion>('motion');

/** At rest, facing the viewer (south) — the deterministic starting pose. */
export const IDLE_MOTION: Motion = {
  moving: false,
  velocityX: 0,
  velocityY: 0,
  facingX: 0,
  facingY: 1,
};

/**
 * How rendering draws an entity. `kind` is a generic scene role
 * (player/building/npc marker), never a career fact; sizes are logical
 * units. `layer` overrides the kind's default draw layer; `spriteRef`
 * names an asset id resolved through the pack's asset manifest.
 */
export type Renderable = {
  readonly kind: string;
  readonly width: number;
  readonly height: number;
  readonly layer?: number;
  readonly spriteRef?: string;
};
export const RENDERABLE = defineComponentType<Renderable>('renderable');

/** Binds a region entity to its content id and live state. */
export type RegionState = { readonly contentId: string; readonly state: string };
export const REGION = defineComponentType<RegionState>('region');

/**
 * The space id every spatial entity inhabits when it carries no SPACE
 * component: the region's outdoor space. Interior spaces are named by the
 * content id of the building that contains them — pack data, never code.
 */
export const SPACE_EXTERIOR = 'space.exterior';

/**
 * Which space a spatial entity inhabits. Spaces partition the one logical
 * simulation space into coexisting populations (the exterior, each building
 * interior): systems that relate entities spatially — collision, prompts,
 * interaction, drawing — only relate entities sharing a space. Absent means
 * the exterior, so worlds without a Buildings System are unchanged
 * (FR-ARCH-008).
 */
export type Space = { readonly space: string };
export const SPACE = defineComponentType<Space>('space');

/**
 * The world's active space slice: which space presentation follows (the
 * player's), plus the running enter/exit transition and its bookkeeping.
 * Shared scene vocabulary like REGION; the Buildings System is its sole
 * writer (FR-ARCH-015). `returnX/returnY` remember where the player stood
 * outside; `armed` gates doorway triggers until the player has stepped off
 * them, so a completed transition never immediately re-fires.
 */
export type ActiveSpace = {
  readonly space: string;
  readonly transition: { readonly to: string; readonly progress: number } | null;
  readonly returnX: number | null;
  readonly returnY: number | null;
  readonly armed: boolean;
};
export const ACTIVE_SPACE = defineComponentType<ActiveSpace>('active-space');

/** The entity's space, the exterior when it carries no SPACE component. */
export function spaceOf(world: EntityStore, entity: EntityId): string {
  return world.getComponent(entity, SPACE)?.space ?? SPACE_EXTERIOR;
}

/** The world's active space, the exterior when no System owns the slice. */
export function activeSpaceOf(world: EntityStore): ActiveSpace {
  for (const entity of world.query(ACTIVE_SPACE)) {
    const active = world.getComponent(entity, ACTIVE_SPACE);
    if (active !== undefined) return active;
  }
  return { space: SPACE_EXTERIOR, transition: null, returnX: null, returnY: null, armed: true };
}

/** Announced once the world has spawned into a region. */
export const REGION_ENTERED = defineEventType<{ readonly regionId: string }>('region.entered');

/** Announced when a player-controlled entity starts or stops moving. */
export const MOVEMENT_STARTED = defineEventType<{ readonly entityId: number }>('movement.started');
export const MOVEMENT_STOPPED = defineEventType<{ readonly entityId: number }>('movement.stopped');

/**
 * The whole-space fit: the uniform scale and centered letterbox offsets
 * that map the logical space onto a surface. Rendering's camera transform
 * builds on the same fit scale; input normalization inverts it.
 */
export function fitTransform(surface: { readonly width: number; readonly height: number }): {
  scale: number;
  offsetX: number;
  offsetY: number;
} {
  const scale = Math.min(
    surface.width / LOGICAL_SPACE.width,
    surface.height / LOGICAL_SPACE.height,
  );
  return {
    scale,
    offsetX: (surface.width - LOGICAL_SPACE.width * scale) / 2,
    offsetY: (surface.height - LOGICAL_SPACE.height * scale) / 2,
  };
}

/**
 * Surface pixels → logical units under the whole-space fit, clamped into
 * the logical space. Camera-aware pointer mapping arrives with the Input
 * System issue; the walking-skeleton view is the whole-space fit.
 */
export function pointerToLogical(
  x: number,
  y: number,
  surface: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = fitTransform(surface);
  if (scale <= 0) return { x: 0, y: 0 };
  return {
    x: Math.min(LOGICAL_SPACE.width, Math.max(0, (x - offsetX) / scale)),
    y: Math.min(LOGICAL_SPACE.height, Math.max(0, (y - offsetY) / scale)),
  };
}

/**
 * The scene plugin: no Systems, just the shared scene component and event
 * types the composition root and presenter consume (FR-ARCH-004/018).
 */
export const scenePlugin: Plugin = {
  id: 'plugin.scene',
  systems: [],
  componentTypes: [RENDERABLE, REGION, SPACE, ACTIVE_SPACE],
  eventTypes: [REGION_ENTERED],
};

/**
 * The per-frame control snapshot the simulation reads (FR-ARCH-023):
 * pressed key codes plus the pointer in LOGICAL coordinates with held
 * button indices. The composition root normalizes the platform's raw
 * snapshot into this shape at sample time, so Systems never see pixels.
 */
export type ControlSnapshot = {
  readonly keys: readonly string[];
  readonly pointer: {
    readonly x: number;
    readonly y: number;
    readonly buttons: readonly number[];
  };
};

const EMPTY_CONTROLS: ControlSnapshot = { keys: [], pointer: { x: 0, y: 0, buttons: [] } };

/**
 * Narrow an untyped input payload into a ControlSnapshot, tolerating any
 * malformed or absent field (FR-ARCH-008): bad input degrades to "no input"
 * rather than faulting the System.
 */
export function readControls(payload: ComponentData): ControlSnapshot {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return EMPTY_CONTROLS;
  }
  const record = payload as { readonly [key: string]: ComponentData };
  const keys = Array.isArray(record['keys'])
    ? record['keys'].filter((key): key is string => typeof key === 'string')
    : [];
  const rawPointer = record['pointer'];
  let pointer = EMPTY_CONTROLS.pointer;
  if (typeof rawPointer === 'object' && rawPointer !== null && !Array.isArray(rawPointer)) {
    const p = rawPointer as { readonly [key: string]: ComponentData };
    pointer = {
      x: typeof p['x'] === 'number' && Number.isFinite(p['x']) ? p['x'] : 0,
      y: typeof p['y'] === 'number' && Number.isFinite(p['y']) ? p['y'] : 0,
      buttons: Array.isArray(p['buttons'])
        ? p['buttons'].filter((b): b is number => typeof b === 'number')
        : [],
    };
  }
  return { keys, pointer };
}
