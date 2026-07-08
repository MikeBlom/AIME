import { describe, expect, it } from 'vitest';
import { EntityStore } from '../core/entity-store';
import { EventBus } from '../core/event-bus';
import type { System, SystemContext } from '../core/registry';
import { ModuleRegistry } from '../core/registry';
import { RuntimeLoop } from '../core/runtime-loop';
import { createHeadlessPlatform } from './headless';
import type { InputSnapshot, Platform } from './types';

// The headless backend is the adapter contract made testable: every
// assertion here goes through the same narrow interfaces the browser
// backend implements, so passing proves the interfaces suffice without a
// host (AC1, NFR-ARCH-002, NFR-ARCH-004).

describe('render surface (deliverable: primitives and sprites)', () => {
  it('draws primitives and sprites through the adapter, recorded in order (AC1)', () => {
    const { render } = createHeadlessPlatform({ width: 64, height: 32 });
    expect(render.size()).toEqual({ width: 64, height: 32 });

    render.clear('#000000');
    render.fillRect(1, 2, 3, 4, '#ff0000');
    render.drawLine(0, 0, 10, 10, '#00ff00', 2);
    render.drawSprite('assets/sprite.png', 5, 6);

    expect(render.commands).toEqual([
      { op: 'clear', color: '#000000' },
      { op: 'fillRect', x: 1, y: 2, width: 3, height: 4, color: '#ff0000' },
      { op: 'drawLine', x1: 0, y1: 0, x2: 10, y2: 10, color: '#00ff00', lineWidth: 2 },
      { op: 'drawSprite', assetRef: 'assets/sprite.png', x: 5, y: 6, width: null, height: null },
    ]);

    render.reset();
    expect(render.commands).toEqual([]);
  });
});

describe('input device (deliverable: per-frame snapshot)', () => {
  it('reads scripted device state through the adapter (AC1)', () => {
    const { input } = createHeadlessPlatform();
    input.press('KeyB');
    input.press('KeyA');
    input.movePointer(12, 34);
    input.setButton(2, true);
    input.setButton(0, true);

    expect(input.snapshot()).toEqual({
      keys: ['KeyA', 'KeyB'],
      pointer: { x: 12, y: 34, buttons: [0, 2] },
    });
  });

  it('snapshots are plain data, not live views: later device changes never alter them', () => {
    const { input } = createHeadlessPlatform();
    input.press('KeyA');
    const before: InputSnapshot = input.snapshot();
    input.release('KeyA');
    input.press('KeyZ');
    expect(before.keys).toEqual(['KeyA']);
    expect(input.snapshot().keys).toEqual(['KeyZ']);
  });

  it('identical device state snapshots to identical data regardless of event order', () => {
    const first = createHeadlessPlatform();
    first.input.press('KeyA');
    first.input.press('KeyB');
    const second = createHeadlessPlatform();
    second.input.press('KeyB');
    second.input.press('KeyA');
    expect(first.input.snapshot()).toEqual(second.input.snapshot());
  });
});

describe('audio and storage stubs (deliverable: interfaces fixed now)', () => {
  it('accepts audio calls and tracks a clamped master volume', () => {
    const { audio } = createHeadlessPlatform();
    audio.play('assets/chime.ogg');
    audio.setMasterVolume(1.5);
    expect(audio.played).toEqual(['assets/chime.ogg']);
    expect(audio.masterVolume).toBe(1);
  });

  it('records cue parameters and looping channel state (audio contract)', () => {
    const { audio } = createHeadlessPlatform();
    audio.play('assets/chime.ogg', { gain: 0.5, pan: -1 });
    expect(audio.playCalls).toEqual([{ soundRef: 'assets/chime.ogg', gain: 0.5, pan: -1 }]);

    audio.setLoop('ambient', 'assets/bed.ogg', { gain: 0.8 });
    audio.setLoop('music', 'assets/tune.ogg');
    expect(audio.loops).toEqual({
      ambient: { soundRef: 'assets/bed.ogg', gain: 0.8 },
      music: { soundRef: 'assets/tune.ogg', gain: 1 },
    });
    audio.setLoop('ambient', null);
    expect(audio.loops).toEqual({ music: { soundRef: 'assets/tune.ogg', gain: 1 } });
  });

  it('storage round-trips and removes values', () => {
    const { storage } = createHeadlessPlatform();
    expect(storage.read('save.slot1')).toBeNull();
    storage.write('save.slot1', '{"progress":1}');
    expect(storage.read('save.slot1')).toBe('{"progress":1}');
    storage.remove('save.slot1');
    expect(storage.read('save.slot1')).toBeNull();
  });
});

describe('timers (deliverable: frame ticker and monotonic probe)', () => {
  it('delivers frames to registered callbacks until stopped', () => {
    const { timers } = createHeadlessPlatform();
    const frames: number[] = [];
    const stop = timers.frameTicker((elapsed) => frames.push(elapsed));
    timers.tick(0.016);
    timers.tick(0.02);
    stop();
    timers.tick(0.016);
    expect(frames).toEqual([0.016, 0.02]);
  });

  it('the monotonic probe advances only when told to (deterministic)', () => {
    const { timers } = createHeadlessPlatform();
    expect(timers.monotonicNowMs()).toBe(0);
    timers.advanceMs(5);
    expect(timers.monotonicNowMs()).toBe(5);
  });
});

describe('consumed via Context (interface contract)', () => {
  it('a System draws from the frozen input snapshot with no host calls anywhere (AC1)', () => {
    const platform = createHeadlessPlatform();
    // The bundle satisfies the layer contract: usable wherever Platform is.
    const asContract: Platform = platform;
    const cursor: System = {
      id: 'test.cursor',
      dependencies: [],
      init: () => {},
      // Reads this frame's immutable snapshot from Context and draws through
      // the Context's platform slot — the full adapter consumption path.
      update: (_dt, context: SystemContext) => {
        const { pointer } = context.input.current as InputSnapshot;
        (context.platform as Platform).render.fillRect(pointer.x, pointer.y, 1, 1, '#ffffff');
      },
      teardown: () => {},
    };
    const registry = new ModuleRegistry();
    registry.register(cursor);
    const loop = new RuntimeLoop(
      registry,
      {
        world: new EntityStore(),
        events: new EventBus(),
        scheduler: { schedule: (task) => task() },
        platform: asContract,
      },
      { fixedDt: 0.01, seed: 42, sampleInput: () => platform.input.snapshot() },
    );

    platform.input.movePointer(7, 9);
    const stop = loop.run(platform.timers.frameTicker);
    platform.timers.tick(0.01);
    stop();

    expect(platform.render.commands).toContainEqual({
      op: 'fillRect',
      x: 7,
      y: 9,
      width: 1,
      height: 1,
      color: '#ffffff',
    });
  });
});
