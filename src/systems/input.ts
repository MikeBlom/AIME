/**
 * Input System — turns the immutable per-frame input snapshot into typed
 * intent events and an owned intent slice (issue #17; spec:
 * docs/14-Input-and-Controls.md).
 *
 * The loop samples devices once per frame into the frozen snapshot every
 * System observes identically (FR-ARCH-023); this System is the one reader
 * that interprets it. Interpretation is data: a bindings table (action →
 * physical key codes) that lives in world state and is remappable by
 * writing a new INPUT_BINDINGS component — no code change (FR-INP-003).
 *
 * Downstream Systems (movement, UI, interaction) never see keys or
 * pointers; they read the INPUT_INTENT slice this System owns
 * (FR-ARCH-015) or subscribe to the intent events it publishes deferred on
 * change (FR-ARCH-012). Keyboard and touch resolve into the same intent
 * vocabulary (FR-INP-004): bound keys drive the move axis, a held primary
 * pointer/touch drives a move-toward target, and the axis wins when both
 * are active. Pure with respect to snapshot + world state: no wall clock,
 * no randomness (NFR-ARCH-001).
 */
import type { EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { readControls } from './scene';

/** Movement/interaction actions the engine understands; bindings map them to keys. */
export type BindingTable = { readonly [action: string]: readonly string[] };

/**
 * The remappable bindings slice: write a new component value to remap
 * (FR-INP-003). Absent, the engine defaults apply.
 */
export type InputBindings = { readonly actions: BindingTable };
export const INPUT_BINDINGS = defineComponentType<InputBindings>('input-bindings');

/**
 * Engine default bindings — physical key codes (layout-independent), data
 * by construction. Arrows and WASD are equivalent out of the box.
 */
export const DEFAULT_BINDINGS: BindingTable = {
  'move-left': ['ArrowLeft', 'KeyA'],
  'move-right': ['ArrowRight', 'KeyD'],
  'move-up': ['ArrowUp', 'KeyW'],
  'move-down': ['ArrowDown', 'KeyS'],
  interact: ['Space', 'Enter', 'KeyE'],
};

/**
 * The per-frame intent slice, owned by this System: the resolved move
 * axis, the optional move-toward target (touch/pointer, logical units),
 * and whether the interact action is held.
 */
export type InputIntent = {
  readonly moveX: number;
  readonly moveY: number;
  readonly toX: number | null;
  readonly toY: number | null;
  readonly interact: boolean;
};
export const INPUT_INTENT = defineComponentType<InputIntent>('input-intent');

const IDLE_INTENT: InputIntent = { moveX: 0, moveY: 0, toX: null, toY: null, interact: false };

/** Published deferred whenever the resolved movement intent changes. */
export const INTENT_MOVE = defineEventType<{
  readonly x: number;
  readonly y: number;
  readonly toX: number | null;
  readonly toY: number | null;
}>('intent.move');

/** Published deferred on each interact press (a held key fires once). */
export const INTENT_INTERACT = defineEventType<Record<string, never>>('intent.interact');

function boundPressed(
  pressed: ReadonlySet<string>,
  bindings: BindingTable,
  action: string,
): boolean {
  return (bindings[action] ?? []).some((key) => pressed.has(key));
}

/** The world's bindings table, defaulting when no INPUT_BINDINGS slice exists. */
export function activeBindings(world: EntityStore): BindingTable {
  for (const entity of world.query(INPUT_BINDINGS)) {
    const bindings = world.getComponent(entity, INPUT_BINDINGS);
    if (bindings !== undefined) return bindings.actions;
  }
  return DEFAULT_BINDINGS;
}

export const inputSystem: System = {
  id: 'input',
  dependencies: [],
  /** Own the intent slice from the start so consumers can always read it. */
  init(context: SystemContext): void {
    if (context.world.query(INPUT_INTENT).length === 0) {
      context.world.addComponent(context.world.createEntity(), INPUT_INTENT, IDLE_INTENT);
    }
  },
  update(_dt: number, context: SystemContext): void {
    const controls = readControls(context.input.current);
    const pressed = new Set(controls.keys);
    const bindings = activeBindings(context.world);

    const moveX =
      (boundPressed(pressed, bindings, 'move-right') ? 1 : 0) -
      (boundPressed(pressed, bindings, 'move-left') ? 1 : 0);
    const moveY =
      (boundPressed(pressed, bindings, 'move-down') ? 1 : 0) -
      (boundPressed(pressed, bindings, 'move-up') ? 1 : 0);
    // Touch/pointer: a held primary button proposes a move-toward target in
    // logical units; an active keyboard axis wins over it (FR-INP-004).
    const pointerHeld = controls.pointer.buttons.includes(0);
    const useTarget = pointerHeld && moveX === 0 && moveY === 0;
    const interact = boundPressed(pressed, bindings, 'interact');

    const intent: InputIntent = {
      moveX,
      moveY,
      toX: useTarget ? controls.pointer.x : null,
      toY: useTarget ? controls.pointer.y : null,
      interact,
    };

    for (const entity of context.world.query(INPUT_INTENT)) {
      const previous = context.world.getComponent(entity, INPUT_INTENT) ?? IDLE_INTENT;
      const moveChanged =
        previous.moveX !== intent.moveX ||
        previous.moveY !== intent.moveY ||
        previous.toX !== intent.toX ||
        previous.toY !== intent.toY;
      if (moveChanged) {
        context.events.publish(INTENT_MOVE, {
          x: intent.moveX,
          y: intent.moveY,
          toX: intent.toX,
          toY: intent.toY,
        });
      }
      if (intent.interact && !previous.interact) {
        context.events.publish(INTENT_INTERACT, {});
      }
      if (moveChanged || previous.interact !== intent.interact) {
        context.world.addComponent(entity, INPUT_INTENT, intent);
      }
    }
  },
  teardown() {},
};

/**
 * The input plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018).
 */
export const inputPlugin: Plugin = {
  id: 'plugin.input',
  systems: [inputSystem],
  componentTypes: [INPUT_BINDINGS, INPUT_INTENT],
  eventTypes: [INTENT_MOVE, INTENT_INTERACT],
};
