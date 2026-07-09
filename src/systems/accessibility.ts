/**
 * Accessibility System — owns the accessibility settings slice and applies
 * control-binding remaps (issue #37; spec: docs/34-Accessibility.md).
 *
 * Two small responsibilities, both data-driven (FR-ARCH-015):
 *
 * 1. The ACCESSIBILITY_SETTINGS slice — reduced motion and screen-reader
 *    narration — mutated only through `accessibility.control` events, the
 *    same request/owner shape as the audio settings. Motion-producing
 *    Systems (camera, render, animation) and the narrating UI read the
 *    slice by query; none of them is ever called (FR-ARCH-005).
 *
 * 2. The INPUT_BINDINGS slice the Input System reads (docs/14 left its
 *    ownership to the settings work): `input.remap` events replace one
 *    action's key codes, so remapping stays a world-state write the remap
 *    UI requests by event and never performs itself (FR-INP-003).
 *
 * Both slices persist through save/load, so a visitor's accessibility
 * choices survive a return visit. Determinism (NFR-ARCH-001): update reads
 * only buffered events and world state — no clocks, no randomness.
 */
import type { EntityId, EntityStore, EventPayload, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import type { BindingTable } from './input';
import { activeBindings, DEFAULT_BINDINGS, INPUT_BINDINGS } from './input';

/**
 * The accessibility settings slice, owned by this System (FR-ARCH-015):
 * reduced motion (camera snaps, transitions cut, sprites rest) and
 * screen-reader narration of essential content (NFR-VIS-003).
 */
export type AccessibilitySettings = {
  readonly reducedMotion: boolean;
  readonly narration: boolean;
};
export const ACCESSIBILITY_SETTINGS =
  defineComponentType<AccessibilitySettings>('accessibility-settings');

/**
 * Narration defaults on: the live region is silent for sighted visitors,
 * while a screen-reader visitor hears the world without first finding a
 * setting they cannot yet perceive. Motion defaults full; reduced motion
 * is one toggle away (docs/34).
 */
export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  reducedMotion: false,
  narration: true,
};

/**
 * Request a settings change. Any subset of fields; this System applies
 * them on its next update — no other System writes the slice directly.
 */
export const ACCESSIBILITY_CONTROL = defineEventType<{
  readonly reducedMotion?: boolean;
  readonly narration?: boolean;
}>('accessibility.control');

/**
 * Request a rebinding: replace one action's physical key codes. Unknown
 * actions and malformed payloads are ignored without faulting the step
 * (FR-ARCH-008). Published by the remap UI; applied only here.
 */
export const INPUT_REMAP = defineEventType<{
  readonly action: string;
  readonly codes: readonly string[];
}>('input.remap');

/** Rebind requests beyond this many codes per action are truncated. */
const MAX_CODES_PER_ACTION = 4;

/**
 * The active accessibility settings by world-state query, defaulting when
 * no slice exists — the one read path every honoring System shares.
 */
export function accessibilitySettingsOf(world: EntityStore): AccessibilitySettings {
  for (const entity of world.query(ACCESSIBILITY_SETTINGS)) {
    const settings = world.getComponent(entity, ACCESSIBILITY_SETTINGS);
    if (settings !== undefined) return settings;
  }
  return DEFAULT_ACCESSIBILITY_SETTINGS;
}

/** True when motion-producing Systems should rest (the shared shorthand). */
export function reducedMotionOf(world: EntityStore): boolean {
  return accessibilitySettingsOf(world).reducedMotion;
}

/** Defensive settings merge: unknown/invalid fields are ignored. */
function mergeSettings(
  settings: AccessibilitySettings,
  payload: EventPayload,
): AccessibilitySettings {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return settings;
  const record = payload as { readonly [key: string]: EventPayload };
  const bool = (key: string, current: boolean): boolean => {
    const value = record[key];
    return typeof value === 'boolean' ? value : current;
  };
  return {
    reducedMotion: bool('reducedMotion', settings.reducedMotion),
    narration: bool('narration', settings.narration),
  };
}

/** A validated remap, or null when the request is malformed (FR-ARCH-008). */
function parseRemap(payload: EventPayload): { action: string; codes: readonly string[] } | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const record = payload as { readonly [key: string]: EventPayload };
  const action = record['action'];
  if (typeof action !== 'string' || DEFAULT_BINDINGS[action] === undefined) return null;
  const raw = record['codes'];
  if (!Array.isArray(raw)) return null;
  const codes = [
    ...new Set(raw.filter((code): code is string => typeof code === 'string' && code !== '')),
  ].slice(0, MAX_CODES_PER_ACTION);
  return codes.length === 0 ? null : { action, codes };
}

/**
 * Build the Accessibility System. A factory (not a shared instance)
 * because the System buffers control and remap events between flush and
 * update; each booted world gets its own instance.
 */
export function createAccessibilitySystem(): System {
  let pendingControls: EventPayload[] = [];
  let pendingRemaps: EventPayload[] = [];
  let unsubscribes: (() => void)[] = [];
  let settingsEntity: EntityId | null = null;

  const reset = () => {
    pendingControls = [];
    pendingRemaps = [];
    settingsEntity = null;
  };

  return {
    id: 'accessibility',
    dependencies: [],
    init(context: SystemContext): void {
      reset();
      // The settings slice: adopt an existing entity (hot re-init, or a
      // restored save) or spawn one with defaults. Sole writer (FR-ARCH-015).
      const existing = context.world.query(ACCESSIBILITY_SETTINGS)[0];
      if (existing === undefined) {
        settingsEntity = context.world.createEntity();
        context.world.addComponent(
          settingsEntity,
          ACCESSIBILITY_SETTINGS,
          DEFAULT_ACCESSIBILITY_SETTINGS,
        );
      } else {
        settingsEntity = existing;
      }
      // The bindings holder is spawned here too (with the engine defaults)
      // so it exists at a deterministic entity id from init — which is what
      // lets a saved remap overlay onto it on resume (FR-ARCH-016).
      if (context.world.query(INPUT_BINDINGS).length === 0) {
        context.world.addComponent(context.world.createEntity(), INPUT_BINDINGS, {
          actions: DEFAULT_BINDINGS,
        });
      }
      unsubscribes.push(
        context.events.subscribe(ACCESSIBILITY_CONTROL, (event) => {
          pendingControls.push(event.payload);
        }),
      );
      unsubscribes.push(
        context.events.subscribe(INPUT_REMAP, (event) => {
          pendingRemaps.push(event.payload);
        }),
      );
    },
    update(_dt: number, context: SystemContext): void {
      if (settingsEntity === null) return;
      const world = context.world;

      if (pendingControls.length > 0) {
        let settings =
          world.getComponent(settingsEntity, ACCESSIBILITY_SETTINGS) ??
          DEFAULT_ACCESSIBILITY_SETTINGS;
        for (const control of pendingControls) settings = mergeSettings(settings, control);
        pendingControls = [];
        world.addComponent(settingsEntity, ACCESSIBILITY_SETTINGS, settings);
      }

      if (pendingRemaps.length > 0) {
        let actions: BindingTable | null = null;
        for (const request of pendingRemaps) {
          const remap = parseRemap(request);
          if (remap === null) continue;
          actions = { ...(actions ?? activeBindings(world)), [remap.action]: remap.codes };
        }
        pendingRemaps = [];
        if (actions !== null) {
          // Adopt the world's bindings entity or spawn one: remapping is a
          // world-state write the Input System reads next step (FR-INP-003).
          const holder = world.query(INPUT_BINDINGS)[0] ?? world.createEntity();
          world.addComponent(holder, INPUT_BINDINGS, { actions });
        }
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
 * The accessibility plugin: the System plus the settings component and the
 * control/remap event types it introduces, registered and removed as one
 * unit (FR-ARCH-018). A factory so every world composes a fresh instance.
 */
export function createAccessibilityPlugin(): Plugin {
  return {
    id: 'plugin.accessibility',
    systems: [createAccessibilitySystem()],
    componentTypes: [ACCESSIBILITY_SETTINGS],
    eventTypes: [ACCESSIBILITY_CONTROL, INPUT_REMAP],
  };
}
