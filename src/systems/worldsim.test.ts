/**
 * World Simulation System suite (issue #28): ambient events fire on a
 * seeded rhythm while the player is idle and replay identically (AC1),
 * placement prefers the player's surroundings so no region reads as
 * static (AC2), and targeted events drive the Animation System's generic
 * one-shot channel so packs can bind visible ambience.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { ANIMATION_ONE_SHOT } from './animation';
import { LOGICAL_SPACE, PLAYER_CONTROLLED, POSITION, RENDERABLE } from './scene';
import {
  AMBIENT_EVENT,
  AMBIENT_KINDS,
  AMBIENT_MAX_INTERVAL,
  AMBIENT_MIN_INTERVAL,
  AMBIENT_NEARBY_RADIUS,
  createWorldSimSystem,
  WORLD_SIM,
} from './worldsim';

const DT = 1 / 60;

function makeContext(seed = 1): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: true }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(seed),
    input: { current: deepFreeze({}) },
  };
}

function spawnMarker(context: SystemContext, kind: string, x: number, y: number): EntityId {
  const marker = context.world.createEntity();
  context.world.addComponent(marker, POSITION, { x, y });
  context.world.addComponent(marker, RENDERABLE, { kind, width: 8, height: 8 });
  return marker;
}

function spawnPlayer(context: SystemContext, x: number, y: number): EntityId {
  const player = context.world.createEntity();
  context.world.addComponent(player, POSITION, { x, y });
  context.world.addComponent(player, PLAYER_CONTROLLED, { speed: 60 });
  return player;
}

type Captured = { kind: string; x: number; y: number; targetId: number | null; step: number };

/** Run `steps` idle fixed steps, capturing every ambient event with its step. */
function runIdle(context: SystemContext, steps: number, seedSystem = createWorldSimSystem()) {
  const events: Captured[] = [];
  context.events.subscribe(AMBIENT_EVENT, (event) => {
    events.push({ ...event.payload, step });
  });
  seedSystem.init(context);
  let step = 0;
  for (step = 0; step < steps; step += 1) {
    seedSystem.update(DT, context);
    context.events.flushDeferred();
  }
  return events;
}

describe('the ambient rhythm (AC1: life while idle)', () => {
  it('fires repeatedly within the documented density window', () => {
    const context = makeContext();
    spawnMarker(context, 'building', 100, 60);
    const events = runIdle(context, Math.ceil((AMBIENT_MAX_INTERVAL * 5) / DT));

    expect(events.length).toBeGreaterThanOrEqual(4); // steady, not one-off
    const gaps = events.slice(1).map((event, i) => (event.step - (events[i]?.step ?? 0)) * DT);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(AMBIENT_MIN_INTERVAL - DT);
      expect(gap).toBeLessThanOrEqual(AMBIENT_MAX_INTERVAL + DT);
    }
    for (const event of events) expect(AMBIENT_KINDS).toContain(event.kind);
  });

  it('replays identically: same seed, same schedule, same events (AC1)', () => {
    const run = (seed: number) => {
      const context = makeContext(seed);
      spawnMarker(context, 'building', 100, 60);
      spawnMarker(context, 'npc', 180, 112);
      spawnPlayer(context, 160, 90);
      return runIdle(context, 1200);
    };
    const first = run(7);
    expect(first.length).toBeGreaterThan(0);
    expect(run(7)).toEqual(first);
  });

  it('draws no randomness at init: the first interval lands in update', () => {
    const context = makeContext();
    const system = createWorldSimSystem();
    const before = context.rng.state;
    system.init(context);
    expect(context.rng.state).toBe(before); // FR-WSM-003
    const [slice] = context.world.query(WORLD_SIM);
    expect(slice).toBeDefined();
  });
});

describe('placement (AC2: no dead space)', () => {
  it('prefers markers within the nearby radius of the player', () => {
    const context = makeContext();
    spawnMarker(context, 'building', 10, 10); // far corner
    const near = spawnMarker(context, 'npc', 130, 90);
    spawnPlayer(context, 120, 90);

    const events = runIdle(context, 1800);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.targetId).toBe(near);
      const dx = event.x - 120;
      const dy = event.y - 90;
      expect(dx * dx + dy * dy).toBeLessThanOrEqual(AMBIENT_NEARBY_RADIUS ** 2);
    }
  });

  it('falls back to distant markers when nothing is nearby', () => {
    const context = makeContext();
    const far = spawnMarker(context, 'building', 10, 10);
    spawnPlayer(context, 300, 170);
    const events = runIdle(context, 600);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.targetId).toBe(far);
  });

  it('a markerless region still breathes: positional events, in bounds', () => {
    const context = makeContext();
    spawnPlayer(context, 160, 90);
    const events = runIdle(context, 600);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.targetId).toBeNull();
      expect(event.x).toBeGreaterThanOrEqual(0);
      expect(event.x).toBeLessThanOrEqual(LOGICAL_SPACE.width);
      expect(event.y).toBeGreaterThanOrEqual(0);
      expect(event.y).toBeLessThanOrEqual(LOGICAL_SPACE.height);
    }
  });
});

describe('visible life through the generic animation channel', () => {
  it('each targeted event requests a matching ambient.<kind> one-shot', () => {
    const context = makeContext();
    const target = spawnMarker(context, 'building', 100, 60);

    const oneShots: { clip: string; entityId?: number }[] = [];
    context.events.subscribe(ANIMATION_ONE_SHOT, (event) => {
      oneShots.push({
        clip: event.payload.clip,
        ...(event.payload.entityId !== undefined ? { entityId: event.payload.entityId } : {}),
      });
    });
    const events = runIdle(context, 600);

    expect(events.length).toBeGreaterThan(0);
    expect(oneShots.length).toBe(events.length);
    events.forEach((event, index) => {
      expect(oneShots[index]).toEqual({ clip: `ambient.${event.kind}`, entityId: target });
    });
  });
});

describe('the scheduler slice (FR-WSM-007)', () => {
  it('is adopted across re-init without duplication', () => {
    const context = makeContext();
    const system = createWorldSimSystem();
    system.init(context);
    system.update(DT, context);
    system.teardown(context);
    const again = createWorldSimSystem();
    again.init(context);
    expect(context.world.query(WORLD_SIM)).toHaveLength(1);
  });
});
