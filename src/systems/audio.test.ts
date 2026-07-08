/**
 * Audio System suite (issue #22): cues answer gameplay events through the
 * adapter (AC1), beds follow region/state/time (AC1), and everything is
 * driven purely by events and world state (AC2) — proven end to end on a
 * booted world with the shipped reference pack.
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { createHeadlessPlatform } from '../platform';
import type { HeadlessPlatform } from '../platform';
import { bootWorld } from '../app';
import { AUDIO_CONTROL, AUDIO_SETTINGS, createAudioSystem, TIME_PHASE_CHANGED } from './audio';
import { ASSET_MANIFEST, CAMERA } from './render';
import { LOGICAL_SPACE, MOVEMENT_STARTED, POSITION, REGION, REGION_ENTERED } from './scene';

const DT = 1 / 60;

interface Harness {
  readonly platform: HeadlessPlatform;
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly context: SystemContext;
  readonly system: ReturnType<typeof createAudioSystem>;
  /** One simulated fixed step: flush deferred events, then update. */
  step(): void;
}

function harness(platformOverride?: SystemContext['platform']): Harness {
  const platform = createHeadlessPlatform();
  const world = new EntityStore();
  const events = new EventBus({ logEnabled: false });
  const context: SystemContext = {
    world,
    events,
    scheduler: { schedule: (task: () => void) => task() },
    platform: platformOverride ?? platform,
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const system = createAudioSystem();
  system.init(context);
  return {
    platform,
    world,
    events,
    context,
    system,
    step: () => {
      events.flushDeferred();
      system.update(DT, context);
    },
  };
}

function addManifest(world: EntityStore, entries: Record<string, string>): void {
  const entity = world.createEntity();
  world.addComponent(entity, ASSET_MANIFEST, { entries });
}

function addRegion(world: EntityStore, contentId: string, state: string) {
  const entity = world.createEntity();
  world.addComponent(entity, REGION, { contentId, state });
  return entity;
}

function addEmitter(world: EntityStore, x: number, y: number) {
  const entity = world.createEntity();
  world.addComponent(entity, POSITION, { x, y });
  return entity;
}

const CENTER = { x: LOGICAL_SPACE.width / 2, y: LOGICAL_SPACE.height / 2 };

describe('event-driven cues (AC1: interactions produce audible feedback)', () => {
  it('plays a manifest-resolved cue when a bound gameplay event arrives', () => {
    const h = harness();
    addManifest(h.world, { 'audio.cue.movement-started': 'assets/a.ogg' });
    const emitter = addEmitter(h.world, CENTER.x, CENTER.y);
    h.events.publish(MOVEMENT_STARTED, { entityId: emitter });
    h.step();
    expect(h.platform.audio.playCalls).toEqual([{ soundRef: 'assets/a.ogg', gain: 1, pan: 0 }]);
  });

  it('a cue key the manifest does not bind stays silent, never faults', () => {
    const h = harness();
    const emitter = addEmitter(h.world, CENTER.x, CENTER.y);
    h.events.publish(MOVEMENT_STARTED, { entityId: emitter });
    expect(() => h.step()).not.toThrow();
    expect(h.platform.audio.playCalls).toEqual([]);
  });

  it('spatialization hook: pan follows the emitter relative to the camera, distance attenuates', () => {
    const h = harness();
    addManifest(h.world, { 'audio.cue.movement-started': 'assets/a.ogg' });
    const camera = h.world.createEntity();
    h.world.addComponent(camera, CAMERA, { x: CENTER.x, y: CENTER.y, zoom: 1 });

    const leftEdge = addEmitter(h.world, 0, CENTER.y);
    h.events.publish(MOVEMENT_STARTED, { entityId: leftEdge });
    h.step();
    const far = h.platform.audio.playCalls[0];
    expect(far?.pan).toBe(-1);
    expect(far?.gain).toBeLessThan(1);

    const near = addEmitter(h.world, CENTER.x + 10, CENTER.y);
    h.events.publish(MOVEMENT_STARTED, { entityId: near });
    h.step();
    const nearCall = h.platform.audio.playCalls[1];
    expect(nearCall?.pan).toBeGreaterThan(0);
    expect(nearCall?.gain).toBeGreaterThan(far?.gain ?? Number.NaN);
  });

  it('an event with no locatable emitter plays centered at full gain', () => {
    const h = harness();
    addManifest(h.world, { 'audio.cue.region-entered': 'assets/enter.ogg' });
    h.events.publish(REGION_ENTERED, { regionId: 'region.somewhere' });
    h.step();
    expect(h.platform.audio.playCalls).toEqual([{ soundRef: 'assets/enter.ogg', gain: 1, pan: 0 }]);
  });
});

describe('ambient beds and the music bus (AC1: beds respond to region/time)', () => {
  const BED_MANIFEST = {
    'audio.ambient.region.r.offline.day': 'assets/offline-day.ogg',
    'audio.ambient.region.r.offline.night': 'assets/offline-night.ogg',
    'audio.ambient.region.r.online': 'assets/online.ogg',
    'audio.music.default': 'assets/music.ogg',
  };

  it('selects the bed from region id, live state, and time phase, most specific first', () => {
    const h = harness();
    addManifest(h.world, BED_MANIFEST);
    const regionEntity = addRegion(h.world, 'region.r', 'offline');

    h.step();
    expect(h.platform.audio.loops['ambient']?.soundRef).toBe('assets/offline-day.ogg');
    expect(h.platform.audio.loops['music']?.soundRef).toBe('assets/music.ogg');

    h.events.publish(TIME_PHASE_CHANGED, { phase: 'night' });
    h.step();
    expect(h.platform.audio.loops['ambient']?.soundRef).toBe('assets/offline-night.ogg');

    h.world.addComponent(regionEntity, REGION, { contentId: 'region.r', state: 'online' });
    h.step();
    expect(h.platform.audio.loops['ambient']?.soundRef).toBe('assets/online.ogg');
  });

  it('falls back to the default bed when no specific key is bound', () => {
    const h = harness();
    addManifest(h.world, { 'audio.ambient.default': 'assets/default.ogg' });
    addRegion(h.world, 'region.r', 'offline');
    h.step();
    expect(h.platform.audio.loops['ambient']?.soundRef).toBe('assets/default.ogg');
  });

  it('no bindings at all means silent channels, never a fault', () => {
    const h = harness();
    addRegion(h.world, 'region.r', 'offline');
    expect(() => h.step()).not.toThrow();
    expect(h.platform.audio.loops).toEqual({});
  });
});

describe('volume, mute, and reduced audio (deliverable: controls)', () => {
  it('applies control events to the settings slice and the master volume', () => {
    const h = harness();
    addManifest(h.world, { 'audio.cue.movement-started': 'assets/a.ogg' });
    h.events.publish(AUDIO_CONTROL, { muted: true });
    h.step();
    expect(h.platform.audio.masterVolume).toBe(0);

    h.events.publish(AUDIO_CONTROL, { muted: false, master: 0.5, sfxGain: 0.25 });
    const emitter = addEmitter(h.world, CENTER.x, CENTER.y);
    h.events.publish(MOVEMENT_STARTED, { entityId: emitter });
    h.step();
    expect(h.platform.audio.masterVolume).toBe(0.5);
    expect(h.platform.audio.playCalls[0]?.gain).toBe(0.25);

    const settingsEntity = h.world.query(AUDIO_SETTINGS)[0];
    expect(settingsEntity).toBeDefined();
    if (settingsEntity !== undefined) {
      expect(h.world.getComponent(settingsEntity, AUDIO_SETTINGS)).toMatchObject({
        muted: false,
        master: 0.5,
        sfxGain: 0.25,
      });
    }
  });

  it('reduced audio silences both beds but keeps interaction feedback (FR-AUD-007)', () => {
    const h = harness();
    addManifest(h.world, {
      'audio.cue.movement-started': 'assets/a.ogg',
      'audio.ambient.default': 'assets/ambient.ogg',
      'audio.music.default': 'assets/music.ogg',
    });
    h.step();
    expect(Object.keys(h.platform.audio.loops).sort()).toEqual(['ambient', 'music']);

    h.events.publish(AUDIO_CONTROL, { reducedAudio: true });
    const emitter = addEmitter(h.world, CENTER.x, CENTER.y);
    h.events.publish(MOVEMENT_STARTED, { entityId: emitter });
    h.step();
    expect(h.platform.audio.loops).toEqual({});
    expect(h.platform.audio.playCalls.map((c) => c.soundRef)).toEqual(['assets/a.ogg']);
  });

  it('malformed control payloads are ignored field by field', () => {
    const h = harness();
    h.events.publish(AUDIO_CONTROL, { master: Number.NaN, muted: true });
    h.step();
    // NaN master ignored (stays 1), mute applied.
    expect(h.platform.audio.masterVolume).toBe(0);
    h.events.publish(AUDIO_CONTROL, { muted: false });
    h.step();
    expect(h.platform.audio.masterVolume).toBe(1);
  });
});

describe('graceful hosts (FR-ARCH-008)', () => {
  it('a platform without an audio interface degrades to silence without faulting', () => {
    const h = harness({});
    h.events.publish(MOVEMENT_STARTED, { entityId: 1 });
    expect(() => h.step()).not.toThrow();
  });
});

describe('end to end on the shipped pack (AC2: driven purely by events and world state)', () => {
  const PACK_ROOT = '/content/pack.reference/';
  const rawFiles = import.meta.glob('/content/pack.reference/**/*.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const PACK_FILES = new Map(
    Object.entries(rawFiles).map(([path, text]) => [path.slice(PACK_ROOT.length), text]),
  );

  function bootSession() {
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    const handle = bootWorld({ platform, packFiles: PACK_FILES, seed: 11 });
    const stop = handle.start();
    return { platform, handle, stop };
  }

  it('a booted world plays the region-enter cue, movement cues, and both beds', () => {
    const { platform, stop } = bootSession();
    platform.timers.tick(DT);
    platform.input.press('KeyD');
    for (let i = 0; i < 5; i += 1) platform.timers.tick(DT);

    const played = platform.audio.playCalls.map((call) => call.soundRef);
    expect(played).toContain('assets/audio/placeholder-region-enter.ogg');
    expect(played).toContain('assets/audio/placeholder-move-start.ogg');
    // The shipped region starts offline; its bed and the default music play.
    expect(platform.audio.loops['ambient']?.soundRef).toBe(
      'assets/audio/placeholder-ambient-offline.ogg',
    );
    expect(platform.audio.loops['music']?.soundRef).toBe('assets/audio/placeholder-music.ogg');
    stop();
  });

  it('two identical sessions issue the identical audio call sequence (determinism)', () => {
    const run = () => {
      const { platform, stop } = bootSession();
      platform.timers.tick(DT);
      platform.input.press('KeyD');
      for (let i = 0; i < 4; i += 1) platform.timers.tick(DT);
      platform.input.release('KeyD');
      for (let i = 0; i < 3; i += 1) platform.timers.tick(DT);
      stop();
      return { calls: platform.audio.playCalls, loops: platform.audio.loops };
    };
    expect(run()).toEqual(run());
  });
});
