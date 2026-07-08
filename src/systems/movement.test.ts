/**
 * Movement System suite (issue #19): acceleration/friction velocity
 * integration from move intents — responsive and frame-rate independent
 * (AC1), bit-reproducible for identical inputs (AC2) — with the MOTION
 * slice exposing velocity and facing for animation and camera consumers.
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import {
  deepFreeze,
  EntityStore,
  EventBus,
  ModuleRegistry,
  RngService,
  RuntimeLoop,
  TimeService,
} from '../core';
import type { InputIntent } from './input';
import { INPUT_INTENT } from './input';
import { DEFAULT_ACCELERATION, DEFAULT_FRICTION, movementPlugin, movementSystem } from './movement';
import {
  IDLE_MOTION,
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
  context.world.addComponent(player, MOTION, IDLE_MOTION);
  return player;
}

function positionOf(context: SystemContext, player: ReturnType<typeof spawnPlayer>) {
  return context.world.getComponent(player, POSITION);
}

function motionOf(context: SystemContext, player: ReturnType<typeof spawnPlayer>) {
  return context.world.getComponent(player, MOTION);
}

describe('acceleration and friction (deliverable: tuned intent translation)', () => {
  it('ramps velocity toward the intent at the acceleration rate, then holds top speed', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context);

    movementSystem.update(DT, context);
    const first = motionOf(context, player);
    expect(first?.velocityX).toBeCloseTo(DEFAULT_ACCELERATION * DT, 10);
    // Semi-implicit integration: the step's new velocity moves the entity.
    expect(positionOf(context, player)?.x).toBeCloseTo(100 + DEFAULT_ACCELERATION * DT * DT, 10);

    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    const cruising = motionOf(context, player);
    expect(cruising?.velocityX).toBe(SPEED); // snapped exactly to top speed
    expect(cruising?.velocityY).toBe(0);
    expect(cruising?.moving).toBe(true);
  });

  it('is responsive: reaches 90% of top speed within 0.2 simulated seconds (AC1)', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 12; i += 1) movementSystem.update(DT, context);
    const motion = motionOf(context, player);
    expect(motion?.velocityX ?? 0).toBeGreaterThanOrEqual(SPEED * 0.9);
  });

  it('coasts to rest under friction when the intent clears, snapping to zero', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    setIntent(context, {});

    let stepsToRest = 0;
    while ((motionOf(context, player)?.moving ?? false) && stepsToRest < 60) {
      movementSystem.update(DT, context);
      stepsToRest += 1;
    }
    const rest = motionOf(context, player);
    expect(rest?.moving).toBe(false);
    expect(rest?.velocityX).toBe(0);
    expect(rest?.velocityY).toBe(0);
    // Friction SPEED -> 0 takes speed/friction seconds, ~4 steps here.
    expect(stepsToRest).toBeLessThanOrEqual(Math.ceil(SPEED / DEFAULT_FRICTION / DT) + 2);
  });

  it('normalizes diagonal intents to the same top speed', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1, moveY: 1 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    const motion = motionOf(context, player);
    const speed = Math.sqrt((motion?.velocityX ?? 0) ** 2 + (motion?.velocityY ?? 0) ** 2);
    expect(speed).toBeCloseTo(SPEED, 10);
  });

  it('per-entity tuning data overrides the engine defaults', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = context.world.createEntity();
    context.world.addComponent(player, POSITION, { x: 100, y: 100 });
    context.world.addComponent(player, PLAYER_CONTROLLED, {
      speed: SPEED,
      acceleration: SPEED / DT, // reach top speed in a single step
    });
    context.world.addComponent(player, MOTION, IDLE_MOTION);
    movementSystem.update(DT, context);
    expect(motionOf(context, player)?.velocityX).toBe(SPEED);
  });
});

describe('velocity and facing exposure (interface contract)', () => {
  it('publishes velocity on the MOTION slice while moving', () => {
    const context = makeContext();
    setIntent(context, { moveY: -1 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    expect(motionOf(context, player)).toMatchObject({
      moving: true,
      velocityX: 0,
      velocityY: -SPEED,
    });
  });

  it('facing is the unit motion direction and holds after stopping', () => {
    const context = makeContext();
    setIntent(context, { moveX: -1 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    expect(motionOf(context, player)).toMatchObject({ facingX: -1, facingY: 0 });

    setIntent(context, {});
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    const rested = motionOf(context, player);
    expect(rested?.moving).toBe(false);
    expect(rested).toMatchObject({ facingX: -1, facingY: 0 }); // held, not reset
  });
});

describe('move-toward targets (touch/pointer intents)', () => {
  it('arrives at the target and settles without orbiting or drifting', () => {
    const context = makeContext();
    setIntent(context, { toX: 140, toY: 100 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 240; i += 1) movementSystem.update(DT, context);
    const settled = positionOf(context, player);
    expect(Math.abs((settled?.x ?? 0) - 140)).toBeLessThanOrEqual(1.5);
    expect(Math.abs((settled?.y ?? 0) - 100)).toBeLessThanOrEqual(1.5);
    // Settled means settled: further steps do not move it.
    const before = { ...(settled ?? { x: 0, y: 0 }) };
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    expect(positionOf(context, player)).toEqual(before);
    expect(motionOf(context, player)?.moving).toBe(false);
  });

  it('prefers the axis when an intent carries both axis and target', () => {
    const context = makeContext();
    setIntent(context, { moveX: -1, toX: 300, toY: 100 });
    const player = spawnPlayer(context);
    for (let i = 0; i < 5; i += 1) movementSystem.update(DT, context);
    expect(positionOf(context, player)?.x).toBeLessThan(100);
  });
});

describe('bounds', () => {
  it('clamps to the traversable space and kills velocity into the wall', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, LOGICAL_SPACE.width - 0.1, 100);
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    expect(positionOf(context, player)?.x).toBe(LOGICAL_SPACE.width);
    // Pressed against the wall the entity is at rest, not grinding.
    expect(motionOf(context, player)?.velocityX).toBe(0);
  });
});

describe('events and graceful degradation', () => {
  it('publishes movement started/stopped on actual motion transitions, deferred', () => {
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
    for (let i = 0; i < 30; i += 1) movementSystem.update(DT, context);
    context.events.flushDeferred();
    expect(stopped).toEqual([player]); // exactly one, when friction rests it
  });

  it('rests when no Input System owns an intent slice (FR-ARCH-008)', () => {
    const context = makeContext();
    const player = spawnPlayer(context);
    expect(() => movementSystem.update(DT, context)).not.toThrow();
    expect(positionOf(context, player)).toEqual({ x: 100, y: 100 });
  });
});

describe('fixed-step integration (AC1 + AC2)', () => {
  function bootLoop() {
    const registry = new ModuleRegistry();
    registry.register(movementPlugin);
    const world = new EntityStore();
    const events = new EventBus();
    const intentEntity = world.createEntity();
    world.addComponent(intentEntity, INPUT_INTENT, IDLE);
    const player = world.createEntity();
    world.addComponent(player, POSITION, { x: 100, y: 100 });
    world.addComponent(player, PLAYER_CONTROLLED, { speed: SPEED });
    world.addComponent(player, MOTION, IDLE_MOTION);
    const loop = new RuntimeLoop(
      registry,
      { world, events, scheduler: { schedule: (task) => task() }, platform: {} },
      { fixedDt: DT, seed: 1 },
    );
    const setLoopIntent = (intent: Partial<InputIntent>) =>
      world.addComponent(intentEntity, INPUT_INTENT, { ...IDLE, ...intent });
    return { loop, world, player, setLoopIntent };
  }

  it('is frame-rate independent: different frame chunkings produce identical motion (AC1)', () => {
    const a = bootLoop();
    const b = bootLoop();
    a.setLoopIntent({ moveX: 1, moveY: 1 });
    b.setLoopIntent({ moveX: 1, moveY: 1 });

    // Same 1 simulated second, delivered as 60 small frames vs 15 big ones.
    for (let i = 0; i < 60; i += 1) a.loop.frame(DT);
    for (let i = 0; i < 15; i += 1) b.loop.frame(4 * DT);

    expect(a.world.getComponent(a.player, POSITION)).toEqual(
      b.world.getComponent(b.player, POSITION),
    );
    expect(a.world.getComponent(a.player, MOTION)).toEqual(b.world.getComponent(b.player, MOTION));
  });

  it('reproduces identical motion for identical input sequences (AC2)', () => {
    const run = () => {
      const session = bootLoop();
      const samples: (readonly [number, number])[] = [];
      const script: Partial<InputIntent>[] = [
        { moveX: 1 },
        { moveX: 1, moveY: -1 },
        {},
        { toX: 250, toY: 40 },
        {},
      ];
      for (const intent of script) {
        session.setLoopIntent(intent);
        for (let i = 0; i < 25; i += 1) {
          session.loop.frame(DT);
          const position = session.world.getComponent(session.player, POSITION);
          samples.push([position?.x ?? -1, position?.y ?? -1]);
        }
      }
      return samples;
    };
    expect(run()).toEqual(run());
  });
});
