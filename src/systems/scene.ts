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
import type { ComponentData, Plugin } from '../core';
import { defineComponentType, defineEventType } from '../core';

/** The fixed logical simulation space, in logical units. */
export const LOGICAL_SPACE = { width: 320, height: 180 } as const;

/** An entity's center in logical units. */
export type Position = { readonly x: number; readonly y: number };
export const POSITION = defineComponentType<Position>('position');

/** Marks the entity the player drives; `speed` is logical units per second. */
export type PlayerControlled = { readonly speed: number };
export const PLAYER_CONTROLLED = defineComponentType<PlayerControlled>('player-controlled');

/** Movement state owned by the movement System (FR-ARCH-015). */
export type Motion = { readonly moving: boolean };
export const MOTION = defineComponentType<Motion>('motion');

/**
 * How the presenter draws an entity. `kind` is a generic scene role
 * (player/building/npc marker), never a career fact; sizes are logical units.
 */
export type Renderable = {
  readonly kind: string;
  readonly width: number;
  readonly height: number;
};
export const RENDERABLE = defineComponentType<Renderable>('renderable');

/** Binds a region entity to its content id and live state. */
export type RegionState = { readonly contentId: string; readonly state: string };
export const REGION = defineComponentType<RegionState>('region');

/** Announced once the world has spawned into a region. */
export const REGION_ENTERED = defineEventType<{ readonly regionId: string }>('region.entered');

/** Announced when a player-controlled entity starts or stops moving. */
export const MOVEMENT_STARTED = defineEventType<{ readonly entityId: number }>('movement.started');
export const MOVEMENT_STOPPED = defineEventType<{ readonly entityId: number }>('movement.stopped');

/**
 * The scene plugin: no Systems, just the shared scene component and event
 * types the composition root and presenter consume (FR-ARCH-004/018).
 */
export const scenePlugin: Plugin = {
  id: 'plugin.scene',
  systems: [],
  componentTypes: [RENDERABLE, REGION],
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
