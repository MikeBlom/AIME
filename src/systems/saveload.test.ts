/**
 * Save/Load System suite (issue #24): a saved session restores to an
 * identical, playable state (AC1, round-trip on a booted world), only
 * mutable world state is serialized — never the content graph (AC2) — and
 * loading is atomic and defensive: corrupt, foreign, or future saves are
 * rejected whole and the world starts fresh.
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import type { HeadlessPlatform } from '../platform';
import { createHeadlessPlatform } from '../platform';
import { bootWorld } from '../app';
import { packFilesFromBundle } from '../app/pack-bundle';
import { AUDIO_SETTINGS, DEFAULT_AUDIO_SETTINGS } from './audio';
import { MOVEMENT_STOPPED, POSITION, REGION } from './scene';
import {
  applySave,
  AUTOSAVE_EVENTS,
  captureSave,
  createSaveLoadSystem,
  loadWorld,
  migrateSave,
  parseSave,
  PROGRESSION_SLICES,
  SAVE_FORMAT,
  SAVE_SLOT_KEY,
  SAVE_VERSION,
  saveWorld,
  WORLD_SAVED,
} from './saveload';
import type { SaveEnvelope } from './saveload';

const DT = 1 / 60;
const SEED = 20260708;
const PACK = { id: 'pack.test', version: '1.0.0' };

interface Harness {
  readonly platform: HeadlessPlatform;
  readonly world: EntityStore;
  readonly context: SystemContext;
}

function harness(platformOverride?: SystemContext['platform']): Harness {
  const platform = createHeadlessPlatform();
  const world = new EntityStore();
  const context: SystemContext = {
    world,
    events: new EventBus({ logEnabled: false }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: platformOverride ?? platform,
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  return { platform, world, context };
}

function bootSession(options?: { save?: string; resume?: boolean }) {
  const platform = createHeadlessPlatform({ width: 640, height: 360 });
  if (options?.save !== undefined) platform.storage.write(SAVE_SLOT_KEY, options.save);
  const handle = bootWorld({
    platform,
    packFiles: packFilesFromBundle(),
    seed: SEED,
    resume: options?.resume ?? false,
  });
  return { platform, handle };
}

/** Drive a booted session: walk right, then stop (which autosaves). */
function walkAndStop(session: ReturnType<typeof bootSession>, frames: number) {
  const { platform, handle } = session;
  const stop = handle.start();
  platform.input.press('ArrowRight');
  for (let i = 0; i < frames; i += 1) platform.timers.tick(DT);
  platform.input.release('ArrowRight');
  for (let i = 0; i < 40; i += 1) platform.timers.tick(DT); // coast to rest → autosave
  stop();
}

function progressionOf(session: ReturnType<typeof bootSession>) {
  const world = session.handle.world;
  const snapshot: Record<string, unknown[]> = {};
  for (const type of PROGRESSION_SLICES) {
    snapshot[type.id] = world
      .query(type)
      .map((entity) => [entity, world.getComponent(entity, type)]);
  }
  return snapshot;
}

describe('round trip on a booted world (AC1: identical, playable state)', () => {
  it('autosaves on rest and restores the identical progression state on resume', () => {
    const live = bootSession();
    walkAndStop(live, 30);
    const saved = live.platform.storage.read(SAVE_SLOT_KEY);
    expect(saved).not.toBeNull();
    const liveState = progressionOf(live);
    // The walk moved the player off spawn, so the round trip is meaningful.
    expect(liveState[POSITION.id]).not.toEqual(progressionOf(bootSession())[POSITION.id]);

    const resumed = bootSession({ save: saved as string, resume: true });
    const stop = resumed.handle.start(); // resume applies at start
    stop();
    expect(progressionOf(resumed)).toEqual(liveState);

    // ...and the restored world stays playable: input still moves the player.
    const restart = resumed.handle.start();
    resumed.platform.input.press('ArrowLeft');
    const before = resumed.handle.world.getComponent(resumed.handle.spawned.player, POSITION);
    for (let i = 0; i < 10; i += 1) resumed.platform.timers.tick(DT);
    restart();
    const after = resumed.handle.world.getComponent(resumed.handle.spawned.player, POSITION);
    expect(after?.x).toBeLessThan(before?.x ?? Number.NaN);
  });

  it('a missing save leaves the fresh spawn untouched (safe resume)', () => {
    const fresh = bootSession();
    const stopFresh = fresh.handle.start();
    stopFresh();
    const resumed = bootSession({ resume: true }); // resume with empty storage
    const stop = resumed.handle.start();
    stop();
    expect(progressionOf(resumed)).toEqual(progressionOf(fresh));
  });
});

describe('what is serialized (AC2: mutable world state only, never content)', () => {
  it('the envelope carries only whitelisted progression slices', () => {
    const live = bootSession();
    walkAndStop(live, 20);
    const envelope = parseSave(live.platform.storage.read(SAVE_SLOT_KEY) as string);
    expect(envelope).not.toBeNull();
    const allowed = new Set(PROGRESSION_SLICES.map((type) => type.id));
    for (const typeId of Object.keys(envelope?.slices ?? {})) {
      expect(allowed.has(typeId), typeId).toBe(true);
    }
  });

  it('serializes no content: no strings, no manifest, no document text', () => {
    const live = bootSession();
    walkAndStop(live, 20);
    const raw = live.platform.storage.read(SAVE_SLOT_KEY) as string;
    expect(raw).not.toContain('locale-strings');
    expect(raw).not.toContain('asset-manifest');
    expect(raw).not.toContain('PLACEHOLDER'); // reference-pack text never leaks
  });
});

describe('capture/apply primitives', () => {
  it('captures declared slices as (entity, value) rows and applies them back', () => {
    const { world } = harness();
    const entity = world.createEntity();
    world.addComponent(entity, POSITION, { x: 12, y: 34 });
    world.addComponent(entity, REGION, { contentId: 'region.a', state: 'online' });

    const envelope = captureSave(world, PACK, [POSITION, REGION]);
    expect(envelope.format).toBe(SAVE_FORMAT);
    expect(envelope.version).toBe(SAVE_VERSION);
    expect(envelope.slices[POSITION.id]).toEqual([[entity, { x: 12, y: 34 }]]);

    world.addComponent(entity, POSITION, { x: 0, y: 0 });
    const applied = applySave(world, envelope, [POSITION, REGION]);
    expect(applied).toBe(2);
    expect(world.getComponent(entity, POSITION)).toEqual({ x: 12, y: 34 });
  });

  it('skips vanished entity ids and non-whitelisted slices, never faulting', () => {
    const { world } = harness();
    const entity = world.createEntity();
    world.addComponent(entity, POSITION, { x: 1, y: 1 });
    const envelope: SaveEnvelope = {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      pack: PACK,
      slices: {
        [POSITION.id]: [
          [entity, { x: 9, y: 9 }],
          [999, { x: 5, y: 5 }], // vanished entity
        ],
        'not-a-slice': [[entity, { evil: true }]],
      },
    };
    expect(applySave(world, envelope, [POSITION])).toBe(1);
    expect(world.getComponent(entity, POSITION)).toEqual({ x: 9, y: 9 });
  });
});

describe('atomic, defensive loading', () => {
  it.each([
    ['not JSON at all', 'garbage{{{'],
    ['wrong format tag', JSON.stringify({ format: 'other', version: 1, pack: PACK, slices: {} })],
    ['missing pack', JSON.stringify({ format: SAVE_FORMAT, version: 1, slices: {} })],
    [
      'malformed slice rows',
      JSON.stringify({ format: SAVE_FORMAT, version: 1, pack: PACK, slices: { p: [[1]] } }),
    ],
    [
      'non-integer entity ids',
      JSON.stringify({
        format: SAVE_FORMAT,
        version: 1,
        pack: PACK,
        slices: { p: [[1.5, {}]] },
      }),
    ],
  ])('rejects a corrupt save whole: %s', (_label, payload) => {
    expect(parseSave(payload)).toBeNull();
    const { platform, context } = harness();
    platform.storage.write(SAVE_SLOT_KEY, payload);
    expect(loadWorld(context, { pack: PACK })).toBe(false);
  });

  it('refuses a save from a different pack or pack version', () => {
    const { platform, world, context } = harness();
    const foreign = captureSave(world, { id: 'pack.other', version: '1.0.0' });
    platform.storage.write(SAVE_SLOT_KEY, JSON.stringify(foreign));
    expect(loadWorld(context, { pack: PACK })).toBe(false);

    const stale = captureSave(world, { id: PACK.id, version: '0.9.0' });
    platform.storage.write(SAVE_SLOT_KEY, JSON.stringify(stale));
    expect(loadWorld(context, { pack: PACK })).toBe(false);
  });

  it('migrates an older envelope forward through registered hooks', () => {
    const older = {
      ...captureSave(new EntityStore(), PACK),
      version: 0,
    } as SaveEnvelope;
    expect(migrateSave(older, [])).toBeNull(); // no path: rejected
    const migrated = migrateSave(older, [
      { from: 0, migrate: (envelope) => ({ ...envelope, version: 1 }) },
    ]);
    expect(migrated?.version).toBe(SAVE_VERSION);
  });

  it('rejects a save from a future engine version instead of guessing', () => {
    const future = { ...captureSave(new EntityStore(), PACK), version: SAVE_VERSION + 1 };
    expect(migrateSave(future as SaveEnvelope, [])).toBeNull();
  });
});

describe('autosave System (deliverable: autosave on key events)', () => {
  it('saves once on the update following a key gameplay event and announces it', () => {
    const { platform, world, context } = harness();
    const entity = world.createEntity();
    world.addComponent(entity, POSITION, { x: 7, y: 7 });
    const system = createSaveLoadSystem({ pack: PACK });
    system.init(context);
    const announced: unknown[] = [];
    context.events.subscribe(WORLD_SAVED, (event) => announced.push(event.payload));

    system.update(DT, context);
    expect(platform.storage.read(SAVE_SLOT_KEY)).toBeNull(); // no event, no save

    context.events.publish(MOVEMENT_STOPPED, { entityId: entity });
    context.events.flushDeferred();
    system.update(DT, context);
    context.events.flushDeferred();
    const stored = platform.storage.read(SAVE_SLOT_KEY);
    expect(parseSave(stored as string)?.slices[POSITION.id]).toEqual([[entity, { x: 7, y: 7 }]]);
    expect(announced).toEqual([{ slot: SAVE_SLOT_KEY }]);

    system.teardown(context);
    context.events.publish(MOVEMENT_STOPPED, { entityId: entity });
    context.events.flushDeferred();
    platform.storage.remove(SAVE_SLOT_KEY);
    system.update(DT, context);
    expect(platform.storage.read(SAVE_SLOT_KEY)).toBeNull(); // unsubscribed
  });

  it('covers region entry among the default autosave triggers', () => {
    expect(AUTOSAVE_EVENTS.map((type) => type.id)).toContain('region.entered');
  });

  it('degrades silently on a host without storage (FR-ARCH-008)', () => {
    const { context } = harness({}); // a platform exposing no storage
    expect(saveWorld(context, { pack: PACK })).toBe(false);
    expect(loadWorld(context, { pack: PACK })).toBe(false);
  });

  it('round-trips audio settings once Systems have initialized their slices', () => {
    const { world, context } = harness();
    const entity = world.createEntity();
    world.addComponent(entity, AUDIO_SETTINGS, { ...DEFAULT_AUDIO_SETTINGS, master: 0.5 });
    expect(saveWorld(context, { pack: PACK })).toBe(true);

    world.addComponent(entity, AUDIO_SETTINGS, DEFAULT_AUDIO_SETTINGS);
    expect(loadWorld(context, { pack: PACK })).toBe(true);
    expect(world.getComponent(entity, AUDIO_SETTINGS)?.master).toBe(0.5);
  });
});
