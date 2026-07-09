/**
 * Physics and Collision suite (issue #20): solids block and never tunnel
 * (AC1, AC2), triggers announce enter/exit deterministically (AC1), and the
 * constraint pass stays stable through a backgrounded-tab catch-up clamp
 * (AC2) — all as a pure function of (world state, fixed dt).
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
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
import { movementPlugin, movementSystem } from './movement';
import type { Box } from './physics';
import {
  boxesOverlap,
  buildBroadphase,
  COLLIDER,
  COLLISION_CONTACTS,
  COLLISION_ENDED,
  COLLISION_STARTED,
  colliderBox,
  physicsPlugin,
  physicsSystem,
  TRIGGER_ENTERED,
  TRIGGER_EXITED,
  TRIGGER_OCCUPANCY,
} from './physics';
import {
  IDLE_MOTION,
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

function setIntent(context: SystemContext, intent: Partial<InputIntent>) {
  const [existing] = context.world.query(INPUT_INTENT);
  const entity = existing ?? context.world.createEntity();
  context.world.addComponent(entity, INPUT_INTENT, { ...IDLE, ...intent });
}

function spawnPlayer(context: SystemContext, x: number, y: number, speed = SPEED) {
  const player = context.world.createEntity();
  context.world.addComponent(player, POSITION, { x, y });
  context.world.addComponent(player, PLAYER_CONTROLLED, { speed });
  context.world.addComponent(player, MOTION, IDLE_MOTION);
  context.world.addComponent(player, COLLIDER, { width: 10, height: 10, mode: 'solid' });
  return player;
}

function spawnSolid(context: SystemContext, x: number, y: number, width: number, height: number) {
  const solid = context.world.createEntity();
  context.world.addComponent(solid, POSITION, { x, y });
  context.world.addComponent(solid, COLLIDER, { width, height, mode: 'solid' });
  return solid;
}

function spawnTrigger(context: SystemContext, x: number, y: number, width: number, height: number) {
  const trigger = context.world.createEntity();
  context.world.addComponent(trigger, POSITION, { x, y });
  context.world.addComponent(trigger, COLLIDER, { width, height, mode: 'trigger' });
  return trigger;
}

/** One fixed step the way the loop runs it: movement proposes, physics constrains. */
function step(context: SystemContext) {
  movementSystem.update(DT, context);
  physicsSystem.update(DT, context);
  context.events.flushDeferred();
}

function positionOf(context: SystemContext, entity: EntityId) {
  return context.world.getComponent(entity, POSITION);
}

describe('solid resolution (AC1: entities cannot pass through solids)', () => {
  it('stops a dead-on approach exactly at the contact face and holds it there', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 100, 100);
    spawnSolid(context, 130, 100, 10, 40); // box 125..135; player face at 120

    for (let i = 0; i < 120; i += 1) {
      step(context);
      expect(positionOf(context, player)?.x ?? 0).toBeLessThanOrEqual(120);
    }
    expect(positionOf(context, player)).toEqual({ x: 120, y: 100 });
  });

  it('slides along a wall: the tangential velocity component survives', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1, moveY: 1 });
    const player = spawnPlayer(context, 100, 100);
    spawnSolid(context, 130, 100, 10, 120); // a long wall on the right

    for (let i = 0; i < 60; i += 1) step(context);
    const position = positionOf(context, player);
    expect(position?.x).toBe(120); // pinned at the face
    expect(position?.y ?? 0).toBeGreaterThan(120); // still travelling down it
  });

  it('zeroes only the blocked velocity component, and keeps the pushing state stable', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 118, 100);
    spawnSolid(context, 130, 100, 10, 40);
    let started = 0;
    let stopped = 0;
    context.events.subscribe(MOVEMENT_STARTED, () => (started += 1));
    context.events.subscribe(MOVEMENT_STOPPED, () => (stopped += 1));

    for (let i = 0; i < 60; i += 1) step(context);
    const motion = context.world.getComponent(player, MOTION);
    expect(motion?.velocityX).toBe(0); // constrained by the contact
    expect(motion?.moving).toBe(true); // still pushing — Movement's judgment
    expect(started).toBe(1); // no start/stop flapping against the wall
    expect(stopped).toBe(0);
  });

  it('movers block each other through the same solid contract', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 100, 100);
    const other = context.world.createEntity();
    context.world.addComponent(other, POSITION, { x: 120, y: 100 });
    context.world.addComponent(other, MOTION, IDLE_MOTION);
    context.world.addComponent(other, COLLIDER, { width: 10, height: 10, mode: 'solid' });

    for (let i = 0; i < 60; i += 1) step(context);
    expect(positionOf(context, player)?.x).toBe(110); // face of the other mover
    expect(positionOf(context, other)).toEqual({ x: 120, y: 100 }); // undisturbed
  });

  it('depenetrates an overlapping spawn along the smaller axis, deterministically', () => {
    const context = makeContext();
    const player = spawnPlayer(context, 104, 100);
    const wall = spawnSolid(context, 100, 100, 20, 20); // player starts inside

    step(context);
    expect(positionOf(context, player)).toEqual({ x: 115, y: 100 }); // pushed out +x
    expect(context.world.getComponent(player, COLLISION_CONTACTS)?.solids).toEqual([wall]);
  });
});

describe('no tunneling (AC2)', () => {
  it('sweeps the whole step: a thin solid blocks arbitrarily fast movers', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = context.world.createEntity();
    context.world.addComponent(player, POSITION, { x: 100, y: 100 });
    // 6000 units/s crosses ~100 units per fixed step — far past the wall.
    context.world.addComponent(player, PLAYER_CONTROLLED, {
      speed: 6000,
      acceleration: 6000 / DT,
    });
    context.world.addComponent(player, MOTION, IDLE_MOTION);
    context.world.addComponent(player, COLLIDER, { width: 10, height: 10, mode: 'solid' });
    spawnSolid(context, 200, 100, 2, 40); // 2 units thin; face at 194

    for (let i = 0; i < 10; i += 1) {
      step(context);
      expect(positionOf(context, player)?.x ?? 0).toBeLessThanOrEqual(194);
    }
    expect(positionOf(context, player)?.x).toBe(194);
  });

  it('stays stable after backgrounding: the catch-up clamp yields the same state as live frames', () => {
    const boot = () => {
      const registry = new ModuleRegistry();
      registry.register(movementPlugin);
      registry.register(physicsPlugin);
      const world = new EntityStore();
      const events = new EventBus();
      const intent = world.createEntity();
      world.addComponent(intent, INPUT_INTENT, { ...IDLE, moveX: 1 });
      const player = world.createEntity();
      world.addComponent(player, POSITION, { x: 100, y: 100 });
      world.addComponent(player, PLAYER_CONTROLLED, { speed: SPEED });
      world.addComponent(player, MOTION, IDLE_MOTION);
      world.addComponent(player, COLLIDER, { width: 10, height: 10, mode: 'solid' });
      const wall = world.createEntity();
      world.addComponent(wall, POSITION, { x: 130, y: 100 });
      world.addComponent(wall, COLLIDER, { width: 10, height: 40, mode: 'solid' });
      const loop = new RuntimeLoop(
        registry,
        { world, events, scheduler: { schedule: (task) => task() }, platform: {} },
        { fixedDt: DT, seed: 1 },
      );
      return { loop, world, player };
    };

    // A 10-second stall is clamped to maxStepsPerFrame fixed steps (5)...
    const stalled = boot();
    stalled.loop.frame(10);
    // ...which must equal the same five steps delivered as live frames.
    const live = boot();
    for (let i = 0; i < 5; i += 1) live.loop.frame(DT);
    expect(stalled.world.getComponent(stalled.player, POSITION)).toEqual(
      live.world.getComponent(live.player, POSITION),
    );

    // And however long it stalls, the wall still holds (no explosion past it).
    for (let i = 0; i < 30; i += 1) stalled.loop.frame(10);
    expect(stalled.world.getComponent(stalled.player, POSITION)?.x).toBeLessThanOrEqual(120);
  });
});

describe('trigger volumes (AC1: deterministic enter/exit)', () => {
  it('announces enter and exit exactly once per pass-through, deferred', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 100, 100);
    const trigger = spawnTrigger(context, 130, 100, 10, 10);
    const entered: (readonly [number, number])[] = [];
    const exited: (readonly [number, number])[] = [];
    context.events.subscribe(TRIGGER_ENTERED, (event) =>
      entered.push([event.payload.entityId, event.payload.triggerId]),
    );
    context.events.subscribe(TRIGGER_EXITED, (event) =>
      exited.push([event.payload.entityId, event.payload.triggerId]),
    );

    for (let i = 0; i < 240; i += 1) step(context); // walk right through it
    expect(positionOf(context, player)?.x ?? 0).toBeGreaterThan(140); // fully past
    expect(entered).toEqual([[player, trigger]]);
    expect(exited).toEqual([[player, trigger]]);
  });

  it('delivers trigger events at the tick boundary (FR-ARCH-012)', () => {
    const context = makeContext();
    const player = spawnPlayer(context, 130, 100); // spawned inside the volume
    const trigger = spawnTrigger(context, 130, 100, 20, 20);
    const entered: number[] = [];
    context.events.subscribe(TRIGGER_ENTERED, (event) => entered.push(event.payload.entityId));

    physicsSystem.update(DT, context);
    expect(entered).toEqual([]); // deferred until the boundary
    expect(context.world.getComponent(trigger, TRIGGER_OCCUPANCY)?.occupants).toEqual([player]);
    context.events.flushDeferred();
    expect(entered).toEqual([player]);
  });

  it('keeps occupancy in world state and clears it on exit', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 118, 100);
    const trigger = spawnTrigger(context, 130, 100, 10, 10);

    for (let i = 0; i < 12; i += 1) step(context); // inside
    expect(context.world.getComponent(trigger, TRIGGER_OCCUPANCY)?.occupants).toEqual([player]);
    for (let i = 0; i < 120; i += 1) step(context); // out the far side
    expect(context.world.hasComponent(trigger, TRIGGER_OCCUPANCY)).toBe(false);
  });

  it('triggers never block movement', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 100, 100);
    spawnTrigger(context, 130, 100, 10, 40);
    for (let i = 0; i < 60; i += 1) step(context);
    expect(positionOf(context, player)?.x ?? 0).toBeGreaterThan(135);
  });
});

describe('collision contact events', () => {
  it('announces contact begin once, and end when the press releases', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = spawnPlayer(context, 110, 100);
    const wall = spawnSolid(context, 130, 100, 10, 40);
    const started: (readonly [number, number])[] = [];
    const ended: (readonly [number, number])[] = [];
    context.events.subscribe(COLLISION_STARTED, (event) =>
      started.push([event.payload.entityId, event.payload.otherId]),
    );
    context.events.subscribe(COLLISION_ENDED, (event) =>
      ended.push([event.payload.entityId, event.payload.otherId]),
    );

    for (let i = 0; i < 60; i += 1) step(context); // reach and grind the wall
    expect(started).toEqual([[player, wall]]); // exactly one begin
    expect(ended).toEqual([]);

    setIntent(context, {}); // stop pressing
    for (let i = 0; i < 10; i += 1) step(context);
    expect(ended).toEqual([[player, wall]]); // exactly one end
  });
});

describe('broadphase', () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({
    minX,
    minY,
    maxX,
    maxY,
  });

  it('narrows candidates to the queried neighborhood, ascending', () => {
    const store = new EntityStore();
    const a = store.createEntity();
    const b = store.createEntity();
    const c = store.createEntity();
    const grid = buildBroadphase([
      [c, box(60, 0, 100, 10)], // spans several cells
      [a, box(0, 0, 10, 10)],
      [b, box(1000, 1000, 1010, 1010)], // far away
    ]);
    expect(grid.query(box(0, 0, 20, 20))).toEqual([a]);
    expect(grid.query(box(70, 0, 80, 10))).toEqual([c]);
    expect(grid.query(box(0, 0, 70, 10))).toEqual([a, c]);
    expect(grid.query(box(500, 500, 510, 510))).toEqual([]);
  });

  it('handles negative coordinates', () => {
    const store = new EntityStore();
    const a = store.createEntity();
    const grid = buildBroadphase([[a, box(-40, -40, -20, -20)]]);
    expect(grid.query(box(-30, -30, -25, -25))).toEqual([a]);
    expect(grid.query(box(10, 10, 20, 20))).toEqual([]);
  });

  it('boxes touching at a face do not overlap (strict)', () => {
    expect(boxesOverlap(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(boxesOverlap(box(0, 0, 10, 10), box(9, 0, 20, 10))).toBe(true);
    expect(colliderBox({ x: 5, y: 5 }, { width: 10, height: 10 })).toEqual(box(0, 0, 10, 10));
  });
});

describe('graceful degradation and determinism', () => {
  it('a world with no colliders is untouched (FR-ARCH-008)', () => {
    const context = makeContext();
    setIntent(context, { moveX: 1 });
    const player = context.world.createEntity();
    context.world.addComponent(player, POSITION, { x: 100, y: 100 });
    context.world.addComponent(player, PLAYER_CONTROLLED, { speed: SPEED });
    context.world.addComponent(player, MOTION, IDLE_MOTION);
    expect(() => {
      for (let i = 0; i < 10; i += 1) step(context);
    }).not.toThrow();
    expect(positionOf(context, player)?.x ?? 0).toBeGreaterThan(100);
  });

  it('reproduces identical trajectories and event sequences for identical inputs', () => {
    const run = () => {
      const context = makeContext();
      const player = spawnPlayer(context, 100, 100);
      spawnSolid(context, 130, 100, 10, 40);
      spawnTrigger(context, 100, 130, 20, 20);
      const samples: (readonly [number, number])[] = [];
      const script: Partial<InputIntent>[] = [{ moveX: 1 }, { moveY: 1 }, { moveX: -1 }, {}];
      for (const intent of script) {
        setIntent(context, intent);
        for (let i = 0; i < 40; i += 1) {
          step(context);
          const position = positionOf(context, player);
          samples.push([position?.x ?? -1, position?.y ?? -1]);
        }
      }
      return { samples, log: context.events.eventLog.map((entry) => entry.type) };
    };
    expect(run()).toEqual(run());
  });
});
