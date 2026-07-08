import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { InputIntent } from './input';
import { INPUT_INTENT } from './input';
import { movementSystem } from './movement';
import {
  LOGICAL_SPACE,
  MOTION,
  MOVEMENT_STARTED,
  MOVEMENT_STOPPED,
  PLAYER_CONTROLLED,
  POSITION,
} from './scene';

const DT = 1 / 60;
const SPEED = 60;

const IDLE: InputIntent = { moveX: 0, moveY: 0, toX: null, toY: null, interact: false };

function makeContext(): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: true }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
}

/** Write the intent slice the way the Input System would. */
function setIntent(context: SystemContext, intent: Partial<InputIntent>) {
  const [existing] = context.world.query(INPUT_INTENT);
  const entity = existing ?? context.world.createEntity();
  context.world.addComponent(entity, INPUT_INTENT, { ...IDLE, ...intent });
}

function spawnPlayer(context: SystemContext, x = 100, y = 100) {
  const player = context.world.createEntity();
  context.world.addComponent(player, POSITION, { x, y });
  context.world.addComponent(player, PLAYER_CONTROLLED, { speed: SPEED });
  context.world.addComponent(player, MOTION, { moving: false });
  return player;
}

describe('movementSystem', () => {
  it('moves the player along each intent axis at speed * dt', () => {
    const cases = [
      { intent: { moveX: 1 }, dx: SPEED * DT, dy: 0 },
      { intent: { moveX: -1 }, dx: -SPEED * DT, dy: 0 },
      { intent: { moveY: 1 }, dx: 0, dy: SPEED * DT },
      { intent: { moveY: -1 }, dx: 0, dy: -SPEED * DT },
    ];
    for (const { intent, dx, dy } of cases) {
      const context = makeContext();
      setIntent(context, intent);
      const player = spawnPlayer(context);
      movementSystem.update(DT, context);
      const position = context.world.getComponent(player, POSITION);
      expect(position?.x).toBeCloseTo(100 + dx, 10);
      expect(position?.y).toBeCloseTo(100 + dy, 10);
    }
  });

  it('normalizes diagonal axis movement to the same speed', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1, moveY: 1 });
    const player = spawnPlayer(context);
    movementSystem.update(DT, context);
    const position = context.world.getComponent(player, POSITION);
    const step = SPEED * DT * Math.SQRT1_2;
    expect(position?.x).toBeCloseTo(100 + step, 10);
    expect(position?.y).toBeCloseTo(100 + step, 10);
  });

  it('steers toward a move-toward target and lands exactly on it', () => {
    const context = makeContext();
    setIntent(context, { toX: 104, toY: 100 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 20; i += 1) movementSystem.update(DT, context);
    const position = context.world.getComponent(player, POSITION);
    expect(position?.x).toBeCloseTo(104, 5);
    expect(position?.y).toBeCloseTo(100, 5);
    // Arrived: further updates stay put (no orbiting or overshoot).
    movementSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)?.x).toBeCloseTo(104, 5);
  });

  it('prefers the axis when an intent carries both axis and target', () => {
    const context = makeContext();
    setIntent(context, { moveX: -1, toX: 300, toY: 100 });
    const player = spawnPlayer(context);
    movementSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)?.x).toBeLessThan(100);
  });

  it('clamps positions to the logical space bounds', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, LOGICAL_SPACE.width - 0.1, 100);
    for (let i = 0; i < 10; i += 1) movementSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)?.x).toBe(LOGICAL_SPACE.width);
  });

  it('publishes movement started/stopped transitions as deferred events', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context);
    const started: number[] = [];
    const stopped: number[] = [];
    context.events.subscribe(MOVEMENT_STARTED, (event) => started.push(event.payload.entityId));
    context.events.subscribe(MOVEMENT_STOPPED, (event) => stopped.push(event.payload.entityId));

    movementSystem.update(DT, context);
    expect(started).toEqual([]); // deferred until the tick boundary (FR-ARCH-012)
    context.events.flushDeferred();
    expect(started).toEqual([player]);

    movementSystem.update(DT, context); // still moving: no repeat event
    context.events.flushDeferred();
    expect(started).toEqual([player]);

    setIntent(context, {});
    movementSystem.update(DT, context);
    context.events.flushDeferred();
    expect(stopped).toEqual([player]);
    expect(context.world.getComponent(player, MOTION)?.moving).toBe(false);
  });

  it('rests when no Input System owns an intent slice (FR-ARCH-008)', () => {
    const context = makeContext();
    const player = spawnPlayer(context);
    expect(() => movementSystem.update(DT, context)).not.toThrow();
    expect(context.world.getComponent(player, POSITION)).toEqual({ x: 100, y: 100 });
  });
});
