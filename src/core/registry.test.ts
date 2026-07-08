import { describe, expect, it } from 'vitest';
import { EntityStore, defineComponentType } from './entity-store';
import { EventBus, defineEventType } from './event-bus';
import { ModuleRegistry } from './registry';
import type { Module, System, SystemContext } from './registry';
import { RngService } from './rng';
import { TimeService } from './time';

/** A fake Context per NFR-ARCH-002: real store/bus, inert scheduler/platform. */
function makeContext(): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus(),
    scheduler: { schedule: () => undefined },
    platform: {},
    time: new TimeService(1 / 60),
    rng: new RngService(1),
    input: { current: {} },
  };
}

/** A trivial System that records every lifecycle call it receives. */
function makeSystem(id: string, dependencies: readonly string[], calls: string[]): System {
  return {
    id,
    dependencies,
    init: () => calls.push(`init:${id}`),
    update: (dt) => calls.push(`update:${id}:${dt}`),
    teardown: () => calls.push(`teardown:${id}`),
  };
}

describe('System lifecycle through the registry (FR-ARCH-005..007)', () => {
  it('a trivial System registers with zero core changes and receives init/update/teardown', () => {
    const registry = new ModuleRegistry();
    const context = makeContext();
    const calls: string[] = [];
    registry.register(makeSystem('sys.trivial', [], calls));
    registry.initAll(context);
    registry.updateAll(0.016, context);
    registry.teardownAll(context);
    expect(calls).toEqual(['init:sys.trivial', 'update:sys.trivial:0.016', 'teardown:sys.trivial']);
  });

  it('lifecycle calls receive the Context exposing world, events, scheduler, and platform', () => {
    const registry = new ModuleRegistry();
    const context = makeContext();
    const seen: SystemContext[] = [];
    registry.register({
      id: 'sys.probe',
      dependencies: [],
      init: (ctx) => seen.push(ctx),
      update: (_dt, ctx) => seen.push(ctx),
      teardown: (ctx) => seen.push(ctx),
    });
    registry.initAll(context);
    registry.updateAll(0.016, context);
    registry.teardownAll(context);
    expect(seen).toEqual([context, context, context]);
    expect(seen[0]?.world).toBeInstanceOf(EntityStore);
    expect(seen[0]?.events).toBeInstanceOf(EventBus);
  });

  it('rejects a duplicate System id loudly', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register(makeSystem('sys.same', [], calls));
    expect(() => registry.register(makeSystem('sys.same', [], calls))).toThrowError(
      /duplicate System id "sys\.same"/,
    );
  });
});

describe('topological ordering with stable tiebreak (FR-ARCH-026..027)', () => {
  it('orders init/update by declared dependencies', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register(makeSystem('sys.camera', ['sys.movement'], calls));
    registry.register(makeSystem('sys.movement', ['sys.input'], calls));
    registry.register(makeSystem('sys.input', [], calls));
    expect(registry.order.map((s) => s.id)).toEqual(['sys.input', 'sys.movement', 'sys.camera']);
  });

  it('breaks ties by registration order, reproducibly', () => {
    const build = () => {
      const registry = new ModuleRegistry();
      const calls: string[] = [];
      registry.register(makeSystem('sys.b', [], calls));
      registry.register(makeSystem('sys.a', [], calls));
      registry.register(makeSystem('sys.c', ['sys.a'], calls));
      return registry.order.map((s) => s.id);
    };
    expect(build()).toEqual(['sys.b', 'sys.a', 'sys.c']);
    expect(build()).toEqual(build());
  });

  it('tears down in reverse dependency order', () => {
    const registry = new ModuleRegistry();
    const context = makeContext();
    const calls: string[] = [];
    registry.register(makeSystem('sys.dependent', ['sys.base'], calls));
    registry.register(makeSystem('sys.base', [], calls));
    registry.teardownAll(context);
    expect(calls).toEqual(['teardown:sys.dependent', 'teardown:sys.base']);
  });

  it('rejects a dependency cycle at load with a diagnostic naming the cycle (FR-ARCH-026)', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register(makeSystem('sys.a', ['sys.c'], calls));
    registry.register(makeSystem('sys.b', ['sys.a'], calls));
    registry.register(makeSystem('sys.c', ['sys.b'], calls));
    expect(() => registry.order).toThrowError(/cycle/);
    expect(() => registry.order).toThrowError(/"sys\.a" -> "sys\.c" -> "sys\.b" -> "sys\.a"/);
  });

  it('ignores a dependency on an absent System instead of failing (FR-ARCH-008)', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register(makeSystem('sys.solo', ['sys.optional-collaborator'], calls));
    expect(registry.order.map((s) => s.id)).toEqual(['sys.solo']);
  });
});

describe('plugin bundles (FR-ARCH-018..020)', () => {
  const Fuel = defineComponentType<number>('plugin.minigame.fuel');
  const Started = defineEventType<{ level: string }>('plugin.minigame.started');

  it('registers Systems, component types, and event types as a unit', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register({
      id: 'plugin.minigame',
      systems: [makeSystem('sys.minigame-host', [], calls)],
      componentTypes: [Fuel],
      eventTypes: [Started],
    });
    expect(registry.order.map((s) => s.id)).toEqual(['sys.minigame-host']);
    expect(registry.componentTypes.get('plugin.minigame.fuel')).toBe(Fuel);
    expect(registry.eventTypes.get('plugin.minigame.started')).toBe(Started);
  });

  it('a missing plugin dependency fails loudly and safely before any lifecycle runs (FR-ARCH-020)', () => {
    const registry = new ModuleRegistry();
    const context = makeContext();
    const calls: string[] = [];
    registry.register({
      id: 'plugin.addon',
      dependencies: ['plugin.base'],
      systems: [makeSystem('sys.addon', [], calls)],
    });
    expect(() => registry.initAll(context)).toThrowError(
      /plugin "plugin\.addon" depends on plugin "plugin\.base", which is not registered/,
    );
    expect(calls).toEqual([]);
  });

  it('a satisfied plugin dependency loads regardless of registration order', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register({
      id: 'plugin.addon',
      dependencies: ['plugin.base'],
      systems: [makeSystem('sys.addon', [], calls)],
    });
    registry.register({ id: 'plugin.base', systems: [makeSystem('sys.base', [], calls)] });
    expect(registry.order.map((s) => s.id)).toEqual(['sys.addon', 'sys.base']);
  });

  it('rejects a plugin that redefines an existing System id, admitting nothing from it', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    registry.register(makeSystem('sys.taken', [], calls));
    expect(() =>
      registry.register({
        id: 'plugin.clash',
        systems: [makeSystem('sys.other', [], calls), makeSystem('sys.taken', [], calls)],
        componentTypes: [Fuel],
      }),
    ).toThrowError(/plugin "plugin\.clash" redefines System id "sys\.taken"/);
    expect(registry.order.map((s) => s.id)).toEqual(['sys.taken']);
    expect(registry.componentTypes.has('plugin.minigame.fuel')).toBe(false);
  });

  it('rejects a plugin whose bundle lists one System id twice, admitting nothing from it', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    expect(() =>
      registry.register({
        id: 'plugin.doubled',
        systems: [makeSystem('sys.twin', [], calls), makeSystem('sys.twin', [], calls)],
      }),
    ).toThrowError(/plugin "plugin\.doubled" redefines System id "sys\.twin"/);
    expect(registry.order).toEqual([]);
  });
});

describe('declarative manifest loading (FR-ARCH-017)', () => {
  it('activates exactly the modules the manifest names, from data', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    const catalog = new Map<string, Module>([
      ['sys.input', makeSystem('sys.input', [], calls)],
      ['sys.movement', makeSystem('sys.movement', ['sys.input'], calls)],
      ['plugin.base', { id: 'plugin.base', systems: [makeSystem('sys.base', [], calls)] }],
    ]);
    registry.loadManifest({ modules: ['sys.movement', 'sys.input'] }, catalog);
    expect(registry.order.map((s) => s.id)).toEqual(['sys.input', 'sys.movement']);
  });

  it('rejects a manifest naming an unknown module without applying any of it', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    const catalog = new Map<string, Module>([['sys.input', makeSystem('sys.input', [], calls)]]);
    expect(() =>
      registry.loadManifest({ modules: ['sys.input', 'sys.ghost'] }, catalog),
    ).toThrowError(/unknown module\(s\) "sys\.ghost"/);
    expect(registry.order).toEqual([]);
  });

  it('rejects a manifest naming a module twice without applying any of it', () => {
    const registry = new ModuleRegistry();
    const calls: string[] = [];
    const catalog = new Map<string, Module>([['sys.input', makeSystem('sys.input', [], calls)]]);
    expect(() =>
      registry.loadManifest({ modules: ['sys.input', 'sys.input'] }, catalog),
    ).toThrowError(/"sys\.input" more than once/);
    expect(registry.order).toEqual([]);
  });
});
