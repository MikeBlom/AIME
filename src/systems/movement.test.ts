import { describe, expect, it } from 'vitest';
import type { ComponentData, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { movementSystem } from './movement';
import {
  LOGICAL_SPACE,
  MOTION,
  MOVEMENT_STARTED,
  MOVEMENT_STOPPED,
  PLAYER_CONTROLLED,
  POSITION,
  readControls,
} from './scene';

const DT = 1 / 60;
const SPEED = 60;

function makeContext(
  input: ComponentData,
): SystemContext & { setInput(next: ComponentData): void } {
  let current = deepFreeze(input);
  return {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: true }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: {
      get current() {
        return current;
      },
    },
    setInput(next: ComponentData) {
      current = deepFreeze(next);
    },
  };
}

function controls(keys: string[], pointer?: { x: number; y: number; buttons: number[] }) {
  return { keys, pointer: pointer ?? { x: 0, y: 0, buttons: [] } };
}

function spawnPlayer(context: SystemContext, x = 100, y = 100) {
  const player = context.world.createEntity();
  context.world.addComponent(player, POSITION, { x, y });
  context.world.addComponent(player, PLAYER_CONTROLLED, { speed: SPEED });
  context.world.addComponent(player, MOTION, { moving: false });
  return player;
}

describe('movementSystem', () => {
  it('moves the player along each keyboard axis at speed * dt', () => {
    const cases = [
      { key: 'ArrowRight', dx: SPEED * DT, dy: 0 },
      { key: 'ArrowLeft', dx: -SPEED * DT, dy: 0 },
      { key: 'ArrowDown', dx: 0, dy: SPEED * DT },
      { key: 'ArrowUp', dx: 0, dy: -SPEED * DT },
      { key: 'KeyD', dx: SPEED * DT, dy: 0 },
      { key: 'KeyA', dx: -SPEED * DT, dy: 0 },
      { key: 'KeyS', dx: 0, dy: SPEED * DT },
      { key: 'KeyW', dx: 0, dy: -SPEED * DT },
    ];
    for (const { key, dx, dy } of cases) {
      const context = makeContext(controls([key]));
      const player = spawnPlayer(context);
      movementSystem.update(DT, context);
      const position = context.world.getComponent(player, POSITION);
      expect(position?.x).toBeCloseTo(100 + dx, 10);
      expect(position?.y).toBeCloseTo(100 + dy, 10);
    }
  });

  it('normalizes diagonal keyboard movement to the same speed', () => {
    const context = makeContext(controls(['KeyD', 'KeyS']));
    const player = spawnPlayer(context);
    movementSystem.update(DT, context);
    const position = context.world.getComponent(player, POSITION);
    const step = SPEED * DT * Math.SQRT1_2;
    expect(position?.x).toBeCloseTo(100 + step, 10);
    expect(position?.y).toBeCloseTo(100 + step, 10);
  });

  it('steers toward a held pointer and lands exactly on the target', () => {
    const target = { x: 104, y: 100 };
    const context = makeContext(controls([], { ...target, buttons: [0] }));
    const player = spawnPlayer(context);
    for (let i = 0; i < 20; i += 1) movementSystem.update(DT, context);
    const position = context.world.getComponent(player, POSITION);
    expect(position?.x).toBeCloseTo(target.x, 5);
    expect(position?.y).toBeCloseTo(target.y, 5);
    // Arrived: further updates stay put (no orbiting or overshoot).
    movementSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)?.x).toBeCloseTo(target.x, 5);
  });

  it('prefers keyboard steering when both keyboard and pointer are active', () => {
    const context = makeContext(controls(['ArrowLeft'], { x: 300, y: 100, buttons: [0] }));
    const player = spawnPlayer(context);
    movementSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)?.x).toBeLessThan(100);
  });

  it('clamps positions to the logical space bounds', () => {
    const context = makeContext(controls(['ArrowRight']));
    const player = spawnPlayer(context, LOGICAL_SPACE.width - 0.1, 100);
    for (let i = 0; i < 10; i += 1) movementSystem.update(DT, context);
    expect(context.world.getComponent(player, POSITION)?.x).toBe(LOGICAL_SPACE.width);
  });

  it('publishes movement started/stopped transitions as deferred events', () => {
    const context = makeContext(controls(['ArrowRight']));
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

    context.setInput(controls([]));
    movementSystem.update(DT, context);
    context.events.flushDeferred();
    expect(stopped).toEqual([player]);
    expect(context.world.getComponent(player, MOTION)?.moving).toBe(false);
  });

  it('tolerates malformed input payloads without moving or throwing', () => {
    for (const payload of [{}, null, 42, { keys: 'nope', pointer: 'nope' }] as ComponentData[]) {
      const context = makeContext(payload);
      const player = spawnPlayer(context);
      expect(() => movementSystem.update(DT, context)).not.toThrow();
      expect(context.world.getComponent(player, POSITION)).toEqual({ x: 100, y: 100 });
    }
  });
});

describe('readControls', () => {
  it('narrows a well-formed payload and defaults every malformed field', () => {
    expect(readControls({ keys: ['KeyA', 3], pointer: { x: 1, y: 2, buttons: [0, 'x'] } })).toEqual(
      { keys: ['KeyA'], pointer: { x: 1, y: 2, buttons: [0] } },
    );
    expect(readControls(null)).toEqual({ keys: [], pointer: { x: 0, y: 0, buttons: [] } });
  });
});
