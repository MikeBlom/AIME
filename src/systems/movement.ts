/**
 * Movement System — drives player-controlled entities from the Input
 * System's intent slice, through the fixed-step loop (issue #15; intent
 * consumption per issue #17).
 *
 * Conforms to the System lifecycle (FR-ARCH-005..008): it reads the
 * INPUT_INTENT world-state slice — never raw keys or pointers — and writes
 * only the slices it owns (position and motion, FR-ARCH-015), announcing
 * start/stop transitions as deferred events (FR-ARCH-012). Its `input`
 * dependency is ordering only: with no Input System registered the intent
 * slice is simply absent and the entity rests (FR-ARCH-008). Update is
 * pure with respect to (world state, dt): no wall clock, no unseeded
 * randomness (NFR-ARCH-001), so recorded sessions replay identically
 * (FR-ARCH-025).
 */
import type { EntityStore, Plugin, System, SystemContext } from '../core';
import { INPUT_INTENT } from './input';
import type { InputIntent } from './input';
import {
  LOGICAL_SPACE,
  MOTION,
  MOVEMENT_STARTED,
  MOVEMENT_STOPPED,
  PLAYER_CONTROLLED,
  POSITION,
} from './scene';

/** Move-toward targets count as reached within this many logical units. */
const ARRIVAL_EPSILON = 0.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The world's current intent, idle when no Input System owns the slice. */
function activeIntent(world: EntityStore): InputIntent {
  for (const entity of world.query(INPUT_INTENT)) {
    const intent = world.getComponent(entity, INPUT_INTENT);
    if (intent !== undefined) return intent;
  }
  return { moveX: 0, moveY: 0, toX: null, toY: null, interact: false };
}

export const movementSystem: System = {
  id: 'movement',
  // Ordering only: consume the intent the Input System resolved this step.
  dependencies: ['input'],
  init() {},
  update(dt: number, context: SystemContext): void {
    const intent = activeIntent(context.world);
    for (const entity of context.world.query(POSITION, PLAYER_CONTROLLED)) {
      const position = context.world.getComponent(entity, POSITION);
      const control = context.world.getComponent(entity, PLAYER_CONTROLLED);
      if (position === undefined || control === undefined) continue;

      let direction = { x: Math.sign(intent.moveX), y: Math.sign(intent.moveY) };
      let stepLength = control.speed * dt;
      if (direction.x === 0 && direction.y === 0 && intent.toX !== null && intent.toY !== null) {
        // Move-toward intent (touch/pointer): head for the target, landing
        // exactly on arrival so the entity never orbits it.
        const dx = intent.toX - position.x;
        const dy = intent.toY - position.y;
        // sqrt is IEEE-correctly-rounded (hypot is not), keeping simulation
        // arithmetic reproducible across hosts (NFR-ARCH-001).
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > ARRIVAL_EPSILON) {
          direction = { x: dx / distance, y: dy / distance };
          stepLength = Math.min(stepLength, distance);
        }
      } else if (direction.x !== 0 && direction.y !== 0) {
        // Normalize diagonals so axis speed is direction-independent.
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
