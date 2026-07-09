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
 *
 * Key capture (the accessibility remap flow, docs/34): while a capture
 * request is active in world state, this System — still the sole snapshot
 * reader (FR-INP-002) — announces the first freshly pressed key as an
 * `input.key-captured` event instead of resolving intents, so a remap UI
 * can rebind actions without ever seeing raw device state itself.
 */
import type { EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { readControls } from './scene';

/** Movement/interaction actions the engine understands; bindings map them to keys. */
export type BindingTable = { readonly [action: string]: readonly string[] };

/**
 * The remappable bindings slice: write a new component value to remap
 * (FR-INP-003). Absent, the engine defaults apply. Ownership discipline:
 * the Accessibility System is its sole writer (docs/34), applying
 * `input.remap` requests published by the settings UI.
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
  settings: ['Escape'],
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

/**
 * A request for raw-key capture (the remap UI's "press a key" state),
 * written by the settings surface's owner and read here — bindings edits
 * stay data-driven and this System stays the only snapshot interpreter
 * (FR-INP-002). While active, intents resolve idle so a key being chosen
 * never also steers the world.
 */
export type InputCapture = { readonly active: boolean };
export const INPUT_CAPTURE = defineComponentType<InputCapture>('input-capture');

/** Published deferred whenever the resolved movement intent changes. */
export const INTENT_MOVE = defineEventType<{
  readonly x: number;
  readonly y: number;
  readonly toX: number | null;
  readonly toY: number | null;
}>('intent.move');

/** Published deferred on each interact press (a held key fires once). */
export const INTENT_INTERACT = defineEventType<Record<string, never>>('intent.interact');

/** Published deferred on each settings-action press (edge, like interact). */
export const INTENT_SETTINGS = defineEventType<Record<string, never>>('intent.settings');

/**
 * Published deferred while capture is active: the first physical key code
 * freshly pressed this frame. Consumers turn it into an `input.remap`
 * request; they never read the snapshot themselves (FR-INP-002).
 */
export const INPUT_KEY_CAPTURED = defineEventType<{ readonly code: string }>('input.key-captured');

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

/** True while any capture request in world state is active. */
function captureActive(world: EntityStore): boolean {
  for (const entity of world.query(INPUT_CAPTURE)) {
    if (world.getComponent(entity, INPUT_CAPTURE)?.active === true) return true;
  }
  return false;
}

/**
 * Build the Input System. A factory (not a shared instance) because the
 * System tracks press edges (settings, capture) across frames; each booted
 * world gets its own instance so state never bleeds across worlds.
 */
export function createInputSystem(): System {
  let lastPressed: ReadonlySet<string> = new Set();
  let lastSettings = false;

  return {
    id: 'input',
    dependencies: [],
    /** Own the intent slice from the start so consumers can always read it. */
    init(context: SystemContext): void {
      lastPressed = new Set();
      lastSettings = false;
      if (context.world.query(INPUT_INTENT).length === 0) {
        context.world.addComponent(context.world.createEntity(), INPUT_INTENT, IDLE_INTENT);
      }
    },
    update(_dt: number, context: SystemContext): void {
      const controls = readControls(context.input.current);
      const pressed = new Set(controls.keys);
      const bindings = activeBindings(context.world);
      const capturing = captureActive(context.world);

      let intent: InputIntent;
      if (capturing) {
        // Capture mode: the first fresh key edge is announced for rebinding
        // and every intent rests idle — a chosen key never also steers the
        // world or toggles surfaces.
        for (const key of controls.keys) {
          if (!lastPressed.has(key)) {
            context.events.publish(INPUT_KEY_CAPTURED, { code: key });
            break;
          }
        }
        intent = IDLE_INTENT;
        lastSettings = boundPressed(pressed, bindings, 'settings');
      } else {
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

        intent = {
          moveX,
          moveY,
          toX: useTarget ? controls.pointer.x : null,
          toY: useTarget ? controls.pointer.y : null,
          interact,
        };

        // The settings action fires once per press, like interact.
        const settingsHeld = boundPressed(pressed, bindings, 'settings');
        if (settingsHeld && !lastSettings) {
          context.events.publish(INTENT_SETTINGS, {});
        }
        lastSettings = settingsHeld;
      }
      lastPressed = pressed;

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
    teardown() {
      lastPressed = new Set();
      lastSettings = false;
    },
  };
}

/**
 * The input plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createInputPlugin(): Plugin {
  return {
    id: 'plugin.input',
    systems: [createInputSystem()],
    componentTypes: [INPUT_BINDINGS, INPUT_INTENT, INPUT_CAPTURE],
    eventTypes: [INTENT_MOVE, INTENT_INTERACT, INTENT_SETTINGS, INPUT_KEY_CAPTURED],
  };
}
