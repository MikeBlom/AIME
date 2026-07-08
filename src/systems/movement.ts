/**
 * Movement System — translates the Input System's move intents into entity
 * motion through acceleration/friction velocity integration (issue #19;
 * spec: docs/15-Movement-and-Traversal.md).
 *
 * Each fixed step it derives a desired velocity from the intent slice
 * (keyboard axes at top speed, or arrive-steering toward a move-toward
 * target), moves the actual velocity toward it at the acceleration rate —
 * or toward rest at the friction rate when the intent clears — then
 * integrates position semi-implicitly and clamps to the traversable space,
 * killing velocity into a boundary. The MOTION slice it owns (FR-ARCH-015)
 * exposes velocity and facing for animation and camera consumers; motion
 * start/stop transitions are announced as deferred events (FR-ARCH-012).
 *
 * Determinism (NFR-ARCH-001): update is pure with respect to (world state,
 * dt) and uses only IEEE-exact arithmetic plus `Math.sqrt` (correctly
 * rounded, unlike `Math.hypot`), so identical inputs reproduce identical
 * motion (FR-ARCH-025). Its `input` dependency is ordering only: with no
 * Input System the intent slice is absent and the entity coasts to rest
 * (FR-ARCH-008).
 */
import type { EntityStore, Plugin, System, SystemContext } from '../core';
import { INPUT_INTENT } from './input';
import type { InputIntent } from './input';
import type { Motion } from './scene';
import {
  IDLE_MOTION,
  LOGICAL_SPACE,
  MOTION,
  MOVEMENT_STARTED,
  MOVEMENT_STOPPED,
  PLAYER_CONTROLLED,
  POSITION,
} from './scene';

/** Engine tuning defaults (logical units/s²); per-entity data overrides. */
export const DEFAULT_ACCELERATION = 720;
export const DEFAULT_FRICTION = 960;

/** Move-toward targets count as reached within this many logical units. */
const ARRIVAL_EPSILON = 0.5;

/** Arrive-steering brakes to this fraction of the ideal stopping speed. */
const ARRIVE_SAFETY = 0.9;

/** Below this speed (units/s) a coasting entity snaps to rest. */
const REST_SPEED_EPSILON = 0.25;

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
      const motion = context.world.getComponent(entity, MOTION) ?? IDLE_MOTION;
      const acceleration = control.acceleration ?? DEFAULT_ACCELERATION;
      const friction = control.friction ?? DEFAULT_FRICTION;

      // Desired velocity from the intent: axis wins over move-toward.
      let desiredX = 0;
      let desiredY = 0;
      const axisX = Math.sign(intent.moveX);
      const axisY = Math.sign(intent.moveY);
      if (axisX !== 0 || axisY !== 0) {
        // Normalize diagonals so top speed is direction-independent.
        const scale = axisX !== 0 && axisY !== 0 ? Math.SQRT1_2 : 1;
        desiredX = axisX * scale * control.speed;
        desiredY = axisY * scale * control.speed;
      } else if (intent.toX !== null && intent.toY !== null) {
        const dx = intent.toX - position.x;
        const dy = intent.toY - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > ARRIVAL_EPSILON) {
          // Arrive steering: cap the approach speed at what can still brake
          // to a stop within the remaining distance, so the entity settles
          // on the target instead of overshooting or orbiting it.
          const arriveSpeed = Math.min(
            control.speed,
            Math.sqrt(2 * acceleration * distance) * ARRIVE_SAFETY,
          );
          desiredX = (dx / distance) * arriveSpeed;
          desiredY = (dy / distance) * arriveSpeed;
        }
      }

      // Velocity integration: approach the desired velocity at the
      // acceleration rate, or coast toward rest at the friction rate.
      const accelerating = desiredX !== 0 || desiredY !== 0;
      const rate = accelerating ? acceleration : friction;
      const deltaX = desiredX - motion.velocityX;
      const deltaY = desiredY - motion.velocityY;
      const deltaLength = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const maxDelta = rate * dt;
      let velocityX: number;
      let velocityY: number;
      if (deltaLength <= maxDelta) {
        velocityX = desiredX;
        velocityY = desiredY;
      } else {
        velocityX = motion.velocityX + (deltaX / deltaLength) * maxDelta;
        velocityY = motion.velocityY + (deltaY / deltaLength) * maxDelta;
      }
      if (
        !accelerating &&
        Math.sqrt(velocityX * velocityX + velocityY * velocityY) < REST_SPEED_EPSILON
      ) {
        velocityX = 0;
        velocityY = 0;
      }

      // Semi-implicit fixed-step integration, clamped to the traversable
      // space; velocity into a boundary dies so the entity rests against
      // it instead of grinding.
      if (velocityX !== 0 || velocityY !== 0) {
        const rawX = position.x + velocityX * dt;
        const rawY = position.y + velocityY * dt;
        const nextX = clamp(rawX, 0, LOGICAL_SPACE.width);
        const nextY = clamp(rawY, 0, LOGICAL_SPACE.height);
        if (nextX !== rawX) velocityX = 0;
        if (nextY !== rawY) velocityY = 0;
        if (nextX !== position.x || nextY !== position.y) {
          context.world.addComponent(entity, POSITION, { x: nextX, y: nextY });
        }
      }

      const speedNow = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
      const moving = speedNow > 0;
      const next: Motion = {
        moving,
        velocityX,
        velocityY,
        // Facing holds its last direction while at rest, so consumers
        // always have a unit direction to point at.
        facingX: moving ? velocityX / speedNow : motion.facingX,
        facingY: moving ? velocityY / speedNow : motion.facingY,
      };
      if (
        next.moving !== motion.moving ||
        next.velocityX !== motion.velocityX ||
        next.velocityY !== motion.velocityY ||
        next.facingX !== motion.facingX ||
        next.facingY !== motion.facingY
      ) {
        context.world.addComponent(entity, MOTION, next);
      }
      if (moving !== motion.moving) {
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
