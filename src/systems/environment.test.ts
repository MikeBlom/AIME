/**
 * Environment System suite (issue #29): the world clock flips phases on
 * the documented cycle, publishing the shared time.phase-changed event and
 * the lighting tint hook (AC1: visible lighting change + NPC routine
 * shifts), and weather follows the region's content profile on a seeded,
 * replay-identical schedule (AC2).
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { TIME_PHASE_CHANGED } from './audio';
import {
  createEnvironmentSystem,
  DAY_SECONDS,
  ENVIRONMENT,
  NIGHT_SECONDS,
  NIGHT_TINT,
  PHASE_DAY,
  PHASE_NIGHT,
  REGION_AMBIENT,
  WEATHER_CHANGED,
  WEATHER_MAX_SECONDS,
  WEATHER_PROFILES,
} from './environment';
import { createNpcSystem, NPC } from './npc';
import { ENVIRONMENT_LIGHT, renderFrame } from './render';
import { IDLE_MOTION, MOTION, POSITION } from './scene';
import { createHeadlessPlatform } from '../platform';

const DT = 1; // coarse fixed steps keep clock tests fast; dt is dt

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

function spawnAmbient(context: SystemContext, weatherProfile: string, dayNight: boolean) {
  const region = context.world.createEntity();
  context.world.addComponent(region, REGION_AMBIENT, { weatherProfile, dayNight });
  return region;
}

function stateOf(context: SystemContext) {
  const [entity] = context.world.query(ENVIRONMENT);
  return entity === undefined ? undefined : context.world.getComponent(entity, ENVIRONMENT);
}

function tintOf(context: SystemContext) {
  const [entity] = context.world.query(ENVIRONMENT_LIGHT);
  return entity === undefined
    ? undefined
    : (context.world.getComponent(entity, ENVIRONMENT_LIGHT)?.tint ?? null);
}

/** Drive `seconds` of simulation, flushing deferred events each step. */
function run(
  context: SystemContext,
  system: ReturnType<typeof createEnvironmentSystem>,
  seconds: number,
) {
  for (let i = 0; i < seconds / DT; i += 1) {
    system.update(DT, context);
    context.events.flushDeferred();
  }
}

describe('the world clock (AC1: time progresses)', () => {
  it('flips day to night and back on the documented cycle, publishing the shared event', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', true);
    const phases: string[] = [];
    context.events.subscribe(TIME_PHASE_CHANGED, (event) => phases.push(event.payload.phase));
    const system = createEnvironmentSystem();
    system.init(context);

    run(context, system, DAY_SECONDS + 1);
    expect(stateOf(context)?.phase).toBe(PHASE_NIGHT);
    run(context, system, NIGHT_SECONDS);
    expect(stateOf(context)?.phase).toBe(PHASE_DAY);
    expect(phases).toEqual([PHASE_NIGHT, PHASE_DAY]);
  });

  it('drives the visible lighting hook: night tints, day clears, render overlays', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', true);
    const system = createEnvironmentSystem();
    system.init(context);

    system.update(DT, context);
    expect(tintOf(context)).toBeNull();

    run(context, system, DAY_SECONDS + 1);
    expect(tintOf(context)).toBe(NIGHT_TINT);

    // The render pass draws the tint as a translucent overlay rect.
    const surface = createHeadlessPlatform({ width: 640, height: 360 }).render;
    renderFrame(0, context, surface);
    const tinted = surface.commands.filter(
      (command) => command['op'] === 'fillRect' && command['color'] === NIGHT_TINT,
    );
    expect(tinted).toHaveLength(1);
  });

  it('shifts NPC routines through the real NPC System (AC1)', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', true);
    const environment = createEnvironmentSystem();
    const npc = createNpcSystem();
    environment.init(context);
    npc.init(context);

    const walker = context.world.createEntity();
    context.world.addComponent(walker, POSITION, { x: 100, y: 100 });
    context.world.addComponent(walker, MOTION, IDLE_MOTION);
    context.world.addComponent(walker, NPC, {
      npcId: 'npc.test-subject',
      dialogueRef: null,
      routine: [
        {
          phase: PHASE_DAY,
          waypoints: [
            { x: 200, y: 100 },
            { x: 100, y: 100 },
          ],
          speed: 10,
        },
        { phase: PHASE_NIGHT, waypoints: [], speed: null },
      ],
    });

    const step = () => {
      environment.update(DT, context);
      npc.update(DT, context);
      context.events.flushDeferred();
    };
    for (let i = 0; i < 5; i += 1) step();
    expect(context.world.getComponent(walker, MOTION)?.moving).toBe(true); // day patrol

    for (let i = 0; i < DAY_SECONDS; i += 1) step();
    // Night: the routine's rest entry applies and the character stands down.
    expect(stateOf(context)?.phase).toBe(PHASE_NIGHT);
    expect(context.world.getComponent(walker, MOTION)?.moving).toBe(false);
  });

  it('holds a steady day when the region opts out of the cycle', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', false);
    const phases: string[] = [];
    context.events.subscribe(TIME_PHASE_CHANGED, (event) => phases.push(event.payload.phase));
    const system = createEnvironmentSystem();
    system.init(context);
    run(context, system, (DAY_SECONDS + NIGHT_SECONDS) * 2);
    expect(stateOf(context)?.phase).toBe(PHASE_DAY);
    expect(phases).toEqual([]);
  });
});

describe('weather (AC2: content profile, reproducible)', () => {
  it('cycles only through the region profile states and announces changes', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', true);
    const profile = WEATHER_PROFILES.get('temperate') ?? [];
    const changes: string[] = [];
    context.events.subscribe(WEATHER_CHANGED, (event) => changes.push(event.payload.weather));
    const system = createEnvironmentSystem();
    system.init(context);

    run(context, system, WEATHER_MAX_SECONDS * 5);
    expect(changes.length).toBeGreaterThanOrEqual(3); // a living sky
    for (const weather of changes) expect(profile).toContain(weather);
    expect(profile).toContain(stateOf(context)?.weather);
  });

  it('replays identically with the same seed (AC2: reproducible under replay)', () => {
    const sequence = (seed: number) => {
      const context = makeContext(seed);
      spawnAmbient(context, 'temperate', true);
      const log: { weather: string; at: number }[] = [];
      let at = 0;
      context.events.subscribe(WEATHER_CHANGED, (event) => {
        log.push({ weather: event.payload.weather, at });
      });
      const system = createEnvironmentSystem();
      system.init(context);
      for (at = 0; at < 400; at += 1) {
        system.update(DT, context);
        context.events.flushDeferred();
      }
      return log;
    };
    const first = sequence(11);
    expect(first.length).toBeGreaterThan(0);
    expect(sequence(11)).toEqual(first);
  });

  it('an unknown profile degrades to the steady default, silently', () => {
    const context = makeContext();
    spawnAmbient(context, 'volcanic', true);
    const changes: string[] = [];
    context.events.subscribe(WEATHER_CHANGED, (event) => changes.push(event.payload.weather));
    const system = createEnvironmentSystem();
    system.init(context);
    run(context, system, WEATHER_MAX_SECONDS * 3);
    expect(changes).toEqual([]);
    expect(stateOf(context)?.weather).toBe('clear');
  });

  it('draws no randomness at init (FR-DNW-007)', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', true);
    const system = createEnvironmentSystem();
    const before = context.rng.state;
    system.init(context);
    expect(context.rng.state).toBe(before);
  });
});

describe('the environment slice (FR-DNW-008)', () => {
  it('is adopted across re-init without duplication', () => {
    const context = makeContext();
    spawnAmbient(context, 'temperate', true);
    const system = createEnvironmentSystem();
    system.init(context);
    system.update(DT, context);
    system.teardown(context);
    const again = createEnvironmentSystem();
    again.init(context);
    expect(context.world.query(ENVIRONMENT)).toHaveLength(1);
    expect(context.world.query(ENVIRONMENT_LIGHT)).toHaveLength(1);
  });
});
