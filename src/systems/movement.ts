/**
 * Movement System — drives player-controlled entities from the per-frame
 * input snapshot, through the fixed-step loop (issue #15's "controllable
 * entity" deliverable).
 *
 * Conforms to the System lifecycle (FR-ARCH-005..008): it reads the Context's
 * input boundary and world state, writes only the slices it owns (position
 * and motion, FR-ARCH-015), and announces start/stop transitions as deferred
 * events (FR-ARCH-012) — it never references another System. Update is pure
 * with respect to (world state, dt, input): no wall clock, no unseeded
 * randomness (NFR-ARCH-001), so a recorded session replays identically
 * (FR-ARCH-025).
 *
 * Controls: arrow keys / WASD move directly (keyboard, NFR-VIS-003); a held
 * primary button or touch steers toward the pointer's logical position
 * (touch, NFR-VIS-004). Keyboard wins when both are active.
 */
import type { Plugin, System, SystemContext } from '../core';
import type { ControlSnapshot } from './scene';
import {
  LOGICAL_SPACE,
  MOTION,
  MOVEMENT_STARTED,
  MOVEMENT_STOPPED,
  PLAYER_CONTROLLED,
  POSITION,
  readControls,
} from './scene';

/** Key codes that steer, mapped to axis contributions. */
const KEY_AXES: ReadonlyMap<string, { readonly x: number; readonly y: number }> = new Map([
  ['ArrowLeft', { x: -1, y: 0 }],
  ['KeyA', { x: -1, y: 0 }],
  ['ArrowRight', { x: 1, y: 0 }],
  ['KeyD', { x: 1, y: 0 }],
  ['ArrowUp', { x: 0, y: -1 }],
  ['KeyW', { x: 0, y: -1 }],
  ['ArrowDown', { x: 0, y: 1 }],
  ['KeyS', { x: 0, y: 1 }],
]);

/** Pointer steering stops within this many logical units of the target. */
const ARRIVAL_EPSILON = 0.5;

function keyboardDirection(controls: ControlSnapshot): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const key of controls.keys) {
    const axis = KEY_AXES.get(key);
    if (axis !== undefined) {
      x += axis.x;
      y += axis.y;
    }
  }
  return { x: Math.sign(x), y: Math.sign(y) };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const movementSystem: System = {
  id: 'movement',
  dependencies: [],
  init() {},
  update(dt: number, context: SystemContext): void {
    const controls = readControls(context.input.current);
    for (const entity of context.world.query(POSITION, PLAYER_CONTROLLED)) {
      const position = context.world.getComponent(entity, POSITION);
      const control = context.world.getComponent(entity, PLAYER_CONTROLLED);
      if (position === undefined || control === undefined) continue;

      let direction = keyboardDirection(controls);
      let stepLength = control.speed * dt;
      if (direction.x === 0 && direction.y === 0 && controls.pointer.buttons.includes(0)) {
        // Touch/pointer steering: head toward the held pointer's logical
        // position, landing exactly on arrival so the entity never orbits.
        const dx = controls.pointer.x - position.x;
        const dy = controls.pointer.y - position.y;
        // sqrt is IEEE-correctly-rounded (hypot is not), keeping simulation
        // arithmetic reproducible across hosts (NFR-ARCH-001).
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > ARRIVAL_EPSILON) {
          direction = { x: dx / distance, y: dy / distance };
          stepLength = Math.min(stepLength, distance);
        }
      } else if (direction.x !== 0 && direction.y !== 0) {
        // Normalize diagonals so keyboard speed is direction-independent.
        const scale = Math.SQRT1_2;
        direction = { x: direction.x * scale, y: direction.y * scale };
      }

      const moving = direction.x !== 0 || direction.y !== 0;
      if (moving) {
        context.world.addComponent(entity, POSITION, {
          x: clamp(position.x + direction.x * stepLength, 0, LOGICAL_SPACE.width),
          y: clamp(position.y + direction.y * stepLength, 0, LOGICAL_SPACE.height),
        });
      }

      const wasMoving = context.world.getComponent(entity, MOTION)?.moving ?? false;
      if (moving !== wasMoving) {
        context.world.addComponent(entity, MOTION, { moving });
        context.events.publish(moving ? MOVEMENT_STARTED : MOVEMENT_STOPPED, {
          entityId: entity,
        });
      }
    }
  },
  teardown() {},
};

/**
 * The movement plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018).
 */
export const movementPlugin: Plugin = {
  id: 'plugin.movement',
  systems: [movementSystem],
  componentTypes: [POSITION, PLAYER_CONTROLLED, MOTION],
  eventTypes: [MOVEMENT_STARTED, MOVEMENT_STOPPED],
};
