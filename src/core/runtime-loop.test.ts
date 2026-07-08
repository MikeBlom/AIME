import { describe, expect, it } from 'vitest';
import { EntityStore, defineComponentType } from './entity-store';
import { EventBus, defineEventType } from './event-bus';
import { ModuleRegistry } from './registry';
import type { System } from './registry';
import { RngService } from './rng';
import type { ContextSeed, RuntimeLoopOptions } from './runtime-loop';
import { RuntimeLoop } from './runtime-loop';

const FIXED_DT = 1 / 60;

const Position = defineComponentType<{ x: number }>('position');
const Nudge = defineEventType<{ amount: number }>('sim.nudge');

function makeSeed(): ContextSeed {
  return {
    world: new EntityStore(),
    events: new EventBus(),
    scheduler: { schedule: () => undefined },
    platform: {},
  };
}

function makeLoop(
  registry: ModuleRegistry,
  options: Partial<RuntimeLoopOptions> = {},
): { loop: RuntimeLoop; seed: ContextSeed } {
  const seed = makeSeed();
  const loop = new RuntimeLoop(registry, seed, { fixedDt: FIXED_DT, seed: 42, ...options });
  return { loop, seed };
}

/** A System that moves an entity using dt, rng, input, and events — every determinism input. */
function makeMoverSystem(): System {
  let entity: ReturnType<EntityStore['createEntity']>;
  return {
    id: 'sys.mover',
    dependencies: [],
    init: (ctx) => {
      entity = ctx.world.createEntity();
      ctx.world.addComponent(entity, Position, { x: 0 });
      ctx.events.subscribe(Nudge, (e) => {
        const p = ctx.world.getComponent(entity, Position) as { x: number };
        ctx.world.addComponent(entity, Position, { x: p.x + e.payload.amount });
      });
    },
    update: (dt, ctx) => {
      const p = ctx.world.getComponent(entity, Position) as { x: number };
      const held = (ctx.input.current as { held?: number }).held ?? 0;
      const x = p.x + dt * held + ctx.rng.next() * 0.001;
      ctx.world.addComponent(entity, Position, { x });
      if (ctx.time.step % 3 === 0) ctx.events.publish(Nudge, { amount: 0.5 });
    },
    teardown: () => undefined,
  };
}

function finalX(seed: ContextSeed): number {
  const [entity] = seed.world.query(Position);
  return (seed.world.getComponent(entity as never, Position) as { x: number }).x;
}

describe('fixed-step simulation (FR-ARCH-021)', () => {
  it('runs whole fixed steps and banks the remainder in the accumulator', () => {
    const registry = new ModuleRegistry();
    const dts: number[] = [];
    registry.register({
      id: 'sys.probe',
      dependencies: [],
      init: () => undefined,
      update: (dt) => dts.push(dt),
      teardown: () => undefined,
    });
    const exactDt = 1 / 64; // binary-exact so the accumulator arithmetic is too
    const { loop } = makeLoop(registry, { fixedDt: exactDt });
    loop.frame(exactDt * 2.5);
    expect(dts).toEqual([exactDt, exactDt]);
    loop.frame(exactDt * 0.5); // banked 0.5 + 0.5 = one more whole step
    expect(dts).toEqual([exactDt, exactDt, exactDt]);
  });

  it('gives presentation an interpolation alpha in [0, 1)', () => {
    const registry = new ModuleRegistry();
    const alphas: number[] = [];
    const { loop } = makeLoop(registry, { onPresent: (alpha) => alphas.push(alpha) });
    loop.frame(FIXED_DT * 1.25);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeCloseTo(0.25, 5);
  });

  it('delivers deferred events at the next step boundary, before Systems update', () => {
    const registry = new ModuleRegistry();
    const order: string[] = [];
    const Ping = defineEventType<{ n: number }>('sim.ping');
    registry.register({
      id: 'sys.pinger',
      dependencies: [],
      init: (ctx) => ctx.events.subscribe(Ping, (e) => order.push(`deliver:${e.payload.n}`)),
      update: (_dt, ctx) => {
        order.push(`update:${ctx.time.step}`);
        if (ctx.time.step === 0) ctx.events.publish(Ping, { n: 1 });
      },
      teardown: () => undefined,
    });
    const { loop } = makeLoop(registry);
    loop.frame(FIXED_DT * 2);
    expect(order).toEqual(['update:0', 'deliver:1', 'update:1']);
  });
});

describe('record/replay determinism (FR-ARCH-025)', () => {
  it('identical content + input + dt sequence yields identical final world state', () => {
    const inputs = [{ held: 1 }, { held: 1 }, { held: 0 }, { held: 2 }, {}];
    const elapsed = [FIXED_DT, FIXED_DT * 1.7, FIXED_DT * 0.4, FIXED_DT * 3.2, FIXED_DT];

    const record = () => {
      const registry = new ModuleRegistry();
      registry.register(makeMoverSystem());
      let frame = 0;
      const { loop, seed } = makeLoop(registry, { sampleInput: () => inputs[frame++] ?? {} });
      loop.startRecording();
      for (const dt of elapsed) loop.frame(dt);
      return { recording: loop.stopRecording(), final: finalX(seed) };
    };

    const { recording, final } = record();
    const registry = new ModuleRegistry();
    registry.register(makeMoverSystem());
    const { loop, seed } = makeLoop(registry); // no live input source: replay supplies it
    loop.replay(recording);
    expect(finalX(seed)).toBe(final);
  });

  it('two identical live runs produce identical state (seeded rng, no wall clock)', () => {
    const run = () => {
      const registry = new ModuleRegistry();
      registry.register(makeMoverSystem());
      const { loop, seed } = makeLoop(registry, { sampleInput: () => ({ held: 1 }) });
      for (let i = 0; i < 10; i += 1) loop.frame(FIXED_DT * 1.3);
      return finalX(seed);
    };
    expect(run()).toBe(run());
  });
});

describe('clamped catch-up and pause/resume (FR-ARCH-022/024)', () => {
  it('backgrounding for minutes produces no time spike on resume', () => {
    const registry = new ModuleRegistry();
    let updates = 0;
    registry.register({
      id: 'sys.counter',
      dependencies: [],
      init: () => undefined,
      update: () => {
        updates += 1;
      },
      teardown: () => undefined,
    });
    const { loop } = makeLoop(registry, { maxStepsPerFrame: 5 });
    loop.frame(180); // three minutes stalled in one frame
    expect(updates).toBe(5); // clamped burst, backlog dropped
    expect(loop.context.time.now).toBeCloseTo(5 * FIXED_DT, 10);
    updates = 0;
    loop.frame(FIXED_DT);
    expect(updates).toBe(1); // next frame is ordinary
  });

  it('pause stops simulation; resume discards stalled time instead of catching up', () => {
    const registry = new ModuleRegistry();
    let updates = 0;
    registry.register({
      id: 'sys.counter',
      dependencies: [],
      init: () => undefined,
      update: () => {
        updates += 1;
      },
      teardown: () => undefined,
    });
    const { loop } = makeLoop(registry);
    loop.frame(FIXED_DT);
    expect(updates).toBe(1);
    loop.pause();
    loop.frame(120); // frames while backgrounded do nothing
    expect(updates).toBe(1);
    loop.resume();
    loop.frame(FIXED_DT);
    expect(updates).toBe(2); // exactly one step: no spike
  });
});

describe('fault isolation (FR-ARCH-029)', () => {
  it('a fault in one System update is isolated and logged; the loop keeps running', () => {
    const registry = new ModuleRegistry();
    const updated: string[] = [];
    registry.register({
      id: 'sys.faulty',
      dependencies: [],
      init: () => undefined,
      update: () => {
        throw new Error('injected fault');
      },
      teardown: () => undefined,
    });
    registry.register({
      id: 'sys.healthy',
      dependencies: [],
      init: () => undefined,
      update: () => {
        updated.push('healthy');
      },
      teardown: () => undefined,
    });
    const faults: string[] = [];
    const { loop } = makeLoop(registry, { onFault: (f) => faults.push(f.systemId) });
    loop.frame(FIXED_DT * 2);
    expect(updated).toEqual(['healthy', 'healthy']); // both steps survived the fault
    expect(faults).toEqual(['sys.faulty', 'sys.faulty']);
    expect(loop.faults).toHaveLength(2);
    expect(loop.faults[0]).toMatchObject({ systemId: 'sys.faulty', step: 0, frame: 0 });
    expect((loop.faults[0]?.error as Error).message).toBe('injected fault');
  });

  it('bounds the fault log so a crash-looping System cannot leak memory', () => {
    const registry = new ModuleRegistry();
    registry.register({
      id: 'sys.crashloop',
      dependencies: [],
      init: () => undefined,
      update: () => {
        throw new Error('always');
      },
      teardown: () => undefined,
    });
    const { loop } = makeLoop(registry);
    for (let i = 0; i < 1100; i += 1) loop.frame(FIXED_DT);
    expect(loop.faults).toHaveLength(1000);
    expect(loop.faults[0]?.step).toBe(100); // oldest entries dropped first
  });
});

describe('immutable input snapshot boundary (FR-ARCH-023)', () => {
  it('freezes each frame snapshot and shows every System the same one', () => {
    const registry = new ModuleRegistry();
    const seen: unknown[] = [];
    for (const id of ['sys.one', 'sys.two']) {
      registry.register({
        id,
        dependencies: [],
        init: () => undefined,
        update: (_dt, ctx) => seen.push(ctx.input.current),
        teardown: () => undefined,
      });
    }
    let tick = 0;
    const { loop } = makeLoop(registry, { sampleInput: () => ({ tick: tick++ }) });
    loop.frame(FIXED_DT);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]); // one snapshot per frame, shared by all Systems
    expect(Object.isFrozen(seen[0])).toBe(true);
    loop.frame(FIXED_DT);
    expect(seen[2]).toEqual({ tick: 1 }); // sampled exactly once per frame
  });
});

describe('services and timing hooks', () => {
  it('exposes seedable time and rng services on the Context', () => {
    const registry = new ModuleRegistry();
    const observed: { now: number; roll: number }[] = [];
    registry.register({
      id: 'sys.observer',
      dependencies: [],
      init: () => undefined,
      update: (_dt, ctx) => observed.push({ now: ctx.time.now, roll: ctx.rng.next() }),
      teardown: () => undefined,
    });
    const { loop } = makeLoop(registry);
    loop.frame(FIXED_DT * 2);
    expect(observed.map((o) => o.now)).toEqual([0, FIXED_DT]);
    const reference = new RngService(42);
    expect(observed.map((o) => o.roll)).toEqual([reference.next(), reference.next()]);
  });

  it('measures per-System update durations with the injected probe only', () => {
    const registry = new ModuleRegistry();
    registry.register({
      id: 'sys.a',
      dependencies: [],
      init: () => undefined,
      update: () => undefined,
      teardown: () => undefined,
    });
    let fakeMs = 0;
    const { loop } = makeLoop(registry, { monotonicNowMs: () => (fakeMs += 2) });
    loop.frame(FIXED_DT);
    expect(loop.lastFrameTimings).toEqual([{ systemId: 'sys.a', milliseconds: 2 }]);

    const { loop: unprobed } = makeLoop(new ModuleRegistry(), {});
    unprobed.frame(FIXED_DT);
    expect(unprobed.lastFrameTimings).toEqual([]); // no probe, no wall clock touched
  });

  it('run() drives frames from a host ticker until stopped', () => {
    const registry = new ModuleRegistry();
    let updates = 0;
    registry.register({
      id: 'sys.counter',
      dependencies: [],
      init: () => undefined,
      update: () => {
        updates += 1;
      },
      teardown: () => undefined,
    });
    const { loop } = makeLoop(registry);
    const callbacks: ((elapsed: number) => void)[] = [];
    let stopped = false;
    const stop = loop.run((onFrame) => {
      callbacks.push(onFrame);
      return () => {
        stopped = true;
      };
    });
    callbacks[0]?.(FIXED_DT);
    callbacks[0]?.(FIXED_DT);
    expect(updates).toBe(2);
    stop();
    expect(stopped).toBe(true);
  });
});
