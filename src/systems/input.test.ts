import { describe, expect, it } from 'vitest';
import type { ComponentData, System, SystemContext } from '../core';
import {
  deepFreeze,
  EntityStore,
  EventBus,
  ModuleRegistry,
  RngService,
  RuntimeLoop,
  TimeService,
} from '../core';
import { readControls } from './scene';
import type { InputIntent } from './input';
import {
  activeBindings,
  DEFAULT_BINDINGS,
  INPUT_BINDINGS,
  INPUT_INTENT,
  INTENT_INTERACT,
  INTENT_MOVE,
  inputSystem,
} from './input';

const DT = 1 / 60;

function makeContext(): SystemContext & { setInput(next: ComponentData): void } {
  let current: ComponentData = deepFreeze({});
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

function intentOf(context: SystemContext): InputIntent | undefined {
  const [entity] = context.world.query(INPUT_INTENT);
  return entity === undefined ? undefined : context.world.getComponent(entity, INPUT_INTENT);
}

describe('inputSystem', () => {
  it('owns an idle intent slice from init', () => {
    const context = makeContext();
    inputSystem.init(context);
    expect(intentOf(context)).toEqual({
      moveX: 0,
      moveY: 0,
      toX: null,
      toY: null,
      interact: false,
    });
  });

  it('resolves default keyboard bindings into the move axis (arrows and WASD alike)', () => {
    const cases = [
      { keys: ['ArrowRight'], moveX: 1, moveY: 0 },
      { keys: ['KeyD'], moveX: 1, moveY: 0 },
      { keys: ['ArrowLeft', 'ArrowUp'], moveX: -1, moveY: -1 },
      { keys: ['KeyA', 'KeyW'], moveX: -1, moveY: -1 },
      { keys: ['KeyS'], moveX: 0, moveY: 1 },
      { keys: ['ArrowLeft', 'ArrowRight'], moveX: 0, moveY: 0 },
    ];
    for (const { keys, moveX, moveY } of cases) {
      const context = makeContext();
      inputSystem.init(context);
      context.setInput(controls(keys));
      inputSystem.update(DT, context);
      expect(intentOf(context), keys.join('+')).toMatchObject({ moveX, moveY });
    }
  });

  it('remaps bindings through world-state data, replacing the defaults', () => {
    const context = makeContext();
    inputSystem.init(context);
    const bindings = context.world.createEntity();
    context.world.addComponent(bindings, INPUT_BINDINGS, {
      actions: { 'move-left': ['KeyJ'], 'move-right': ['KeyL'] },
    });

    context.setInput(controls(['KeyJ']));
    inputSystem.update(DT, context);
    expect(intentOf(context)).toMatchObject({ moveX: -1 });

    // The remap replaced the table: the default arrow no longer binds.
    context.setInput(controls(['ArrowRight']));
    inputSystem.update(DT, context);
    expect(intentOf(context)).toMatchObject({ moveX: 0, moveY: 0 });

    expect(activeBindings(context.world)).not.toBe(DEFAULT_BINDINGS);
  });

  it('turns a held primary pointer/touch into a move-toward target', () => {
    const context = makeContext();
    inputSystem.init(context);
    context.setInput(controls([], { x: 250, y: 90, buttons: [0] }));
    inputSystem.update(DT, context);
    expect(intentOf(context)).toEqual({
      moveX: 0,
      moveY: 0,
      toX: 250,
      toY: 90,
      interact: false,
    });
  });

  it('lets an active keyboard axis win over a held pointer (FR-INP-004)', () => {
    const context = makeContext();
    inputSystem.init(context);
    context.setInput(controls(['ArrowLeft'], { x: 250, y: 90, buttons: [0] }));
    inputSystem.update(DT, context);
    expect(intentOf(context)).toMatchObject({ moveX: -1, toX: null, toY: null });
  });

  it('publishes intent.move deferred only when the resolved intent changes', () => {
    const context = makeContext();
    inputSystem.init(context);
    const moves: { x: number; y: number }[] = [];
    context.events.subscribe(INTENT_MOVE, (event) =>
      moves.push({ x: event.payload.x, y: event.payload.y }),
    );

    context.setInput(controls(['ArrowRight']));
    inputSystem.update(DT, context);
    expect(moves).toEqual([]); // deferred until the tick boundary (FR-ARCH-012)
    context.events.flushDeferred();
    expect(moves).toEqual([{ x: 1, y: 0 }]);

    inputSystem.update(DT, context); // unchanged intent: no repeat event
    context.events.flushDeferred();
    expect(moves).toEqual([{ x: 1, y: 0 }]);

    context.setInput(controls([]));
    inputSystem.update(DT, context);
    context.events.flushDeferred();
    expect(moves).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('publishes intent.interact once per press, not while held', () => {
    const context = makeContext();
    inputSystem.init(context);
    let interactions = 0;
    context.events.subscribe(INTENT_INTERACT, () => {
      interactions += 1;
    });

    context.setInput(controls(['Space']));
    inputSystem.update(DT, context);
    inputSystem.update(DT, context); // held: still one press
    context.setInput(controls([]));
    inputSystem.update(DT, context);
    context.setInput(controls(['KeyE']));
    inputSystem.update(DT, context); // any bound key presses again
    context.events.flushDeferred();
    expect(interactions).toBe(2);
  });

  it('tolerates malformed input payloads as idle intent (FR-ARCH-008)', () => {
    const context = makeContext();
    inputSystem.init(context);
    for (const payload of [null, 7, { keys: 'x', pointer: [] }] as ComponentData[]) {
      context.setInput(payload);
      expect(() => inputSystem.update(DT, context)).not.toThrow();
      expect(intentOf(context)).toMatchObject({ moveX: 0, moveY: 0, toX: null });
    }
  });
});

describe('per-frame snapshot boundary (FR-ARCH-023)', () => {
  it('every System observes the identical frozen snapshot within a frame', () => {
    const registry = new ModuleRegistry();
    const seen: ComponentData[] = [];
    const probe = (id: string, dependencies: string[]): System => ({
      id,
      dependencies,
      init() {},
      update(_dt, context) {
        seen.push(context.input.current);
      },
      teardown() {},
    });
    registry.register(inputSystem);
    registry.register(probe('probe-a', ['input']));
    registry.register(probe('probe-b', ['probe-a']));

    // Device state mutates between frames; the loop samples once per frame.
    let keys: string[] = ['ArrowRight'];
    const loop = new RuntimeLoop(
      registry,
      {
        world: new EntityStore(),
        events: new EventBus(),
        scheduler: { schedule: (task: () => void) => task() },
        platform: {},
      },
      { fixedDt: DT, seed: 1, sampleInput: () => controls(keys) },
    );
    loop.frame(DT);
    keys = ['KeyA'];
    loop.frame(DT);

    // Two probes × two frames: identical object within a frame, a fresh
    // frozen snapshot across frames.
    expect(seen).toHaveLength(4);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).toBe(seen[3]);
    expect(seen[0]).not.toBe(seen[2]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(seen[0]).toMatchObject({ keys: ['ArrowRight'] });
    expect(seen[2]).toMatchObject({ keys: ['KeyA'] });
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
