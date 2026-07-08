/**
 * Camera System suite (issue #18): damped follow without jitter or
 * overshoot, region-extent clamping (AC1), late-update ordering after
 * movement (AC2), and the zoom request hook — unit-tested against a bare
 * context and end-to-end on a booted world.
 */
import { describe, expect, it } from 'vitest';
import type { System, SystemContext } from '../core';
import {
  deepFreeze,
  EntityStore,
  EventBus,
  ModuleRegistry,
  RngService,
  TimeService,
} from '../core';
import { createHeadlessPlatform } from '../platform';
import { bootWorld } from '../app';
import {
  CAMERA_FOLLOW,
  CAMERA_ZOOM_REQUESTED,
  clampToRegionExtents,
  createCameraPlugin,
  createCameraSystem,
  ZOOM_MAX,
} from './camera';
import { movementPlugin } from './movement';
import { CAMERA } from './render';
import { LOGICAL_SPACE, PLAYER_CONTROLLED, POSITION } from './scene';

const DT = 1 / 60;
const CENTER = { x: LOGICAL_SPACE.width / 2, y: LOGICAL_SPACE.height / 2 };

function makeContext(): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus({ logEnabled: false }),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
}

function addPlayer(world: EntityStore, x: number, y: number) {
  const player = world.createEntity();
  world.addComponent(player, POSITION, { x, y });
  world.addComponent(player, PLAYER_CONTROLLED, { speed: 60 });
  return player;
}

/** Init the system (it creates and adopts a camera entity) and read helpers. */
function harness() {
  const context = makeContext();
  const system = createCameraSystem();
  system.init(context);
  const cameraEntity = context.world.query(CAMERA)[0];
  if (cameraEntity === undefined) throw new Error('camera system created no camera entity');
  return {
    context,
    system,
    cameraEntity,
    camera: () => {
      const camera = context.world.getComponent(cameraEntity, CAMERA);
      if (camera === undefined) throw new Error('camera component vanished');
      return camera;
    },
    setView: (x: number, y: number, zoom: number, zoomTarget = zoom) => {
      context.world.addComponent(cameraEntity, CAMERA, { x, y, zoom });
      context.world.addComponent(cameraEntity, CAMERA_FOLLOW, {
        damping: 8,
        zoomTarget,
        enabled: true,
      });
    },
    step: (frames = 1) => {
      for (let i = 0; i < frames; i += 1) {
        context.events.flushDeferred();
        system.update(DT, context);
      }
    },
  };
}

describe('damped follow (AC1: smooth, no jitter, no overshoot)', () => {
  it('approaches the player monotonically and lands exactly on target', () => {
    const h = harness();
    addPlayer(h.context.world, 200, 90);
    h.setView(CENTER.x, CENTER.y, 2); // zoomed in so bounds allow tracking
    let previous = h.camera().x;
    let previousDistance = 200 - previous;
    for (let i = 0; i < 200; i += 1) {
      h.step();
      const current = h.camera().x;
      // Monotonic toward the target, never past it (no oscillation).
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current).toBeLessThanOrEqual(200);
      const distance = 200 - current;
      expect(distance).toBeLessThanOrEqual(previousDistance);
      previous = current;
      previousDistance = distance;
    }
    expect(h.camera().x).toBe(200);
    expect(h.camera().y).toBe(90);
  });

  it('a still player and settled camera produce no camera writes (steady state)', () => {
    const h = harness();
    addPlayer(h.context.world, CENTER.x, CENTER.y);
    const before = h.camera();
    h.step(10);
    expect(h.camera()).toBe(before); // same object: no rewrite happened
  });

  it('with no player the camera holds the region center', () => {
    const h = harness();
    h.setView(100, 100, 2);
    h.step(400);
    expect(h.camera().x).toBe(CENTER.x);
    expect(h.camera().y).toBe(CENTER.y);
  });
});

describe('region bounds (AC1: the view never leaves the region extents)', () => {
  it('clamps the center so the visible span stays inside the region', () => {
    expect(clampToRegionExtents(315, 175, 2)).toEqual({ x: 240, y: 135 });
    expect(clampToRegionExtents(0, 0, 2)).toEqual({ x: 80, y: 45 });
    // Zoom 1 sees the whole region: the center is pinned.
    expect(clampToRegionExtents(300, 20, 1)).toEqual(CENTER);
  });

  it('following a corner player converges to the clamped center, not the player', () => {
    const h = harness();
    addPlayer(h.context.world, 315, 175);
    h.setView(CENTER.x, CENTER.y, 2);
    h.step(600);
    expect(h.camera().x).toBe(240);
    expect(h.camera().y).toBe(135);
  });

  it('at zoom 1 the camera stays centered no matter where the player goes', () => {
    const h = harness();
    addPlayer(h.context.world, 300, 20);
    h.step(120);
    expect(h.camera().x).toBe(CENTER.x);
    expect(h.camera().y).toBe(CENTER.y);
  });
});

describe('zoom hooks (deliverable)', () => {
  it('eases toward a requested zoom, monotonically', () => {
    const h = harness();
    h.context.events.publish(CAMERA_ZOOM_REQUESTED, { zoom: 2 });
    let previous = h.camera().zoom;
    h.step();
    for (let i = 0; i < 200; i += 1) {
      h.step();
      const current = h.camera().zoom;
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current).toBeLessThanOrEqual(2);
      previous = current;
    }
    expect(h.camera().zoom).toBe(2);
  });

  it('clamps requests to the zoom limits and ignores malformed ones', () => {
    const h = harness();
    h.context.events.publish(CAMERA_ZOOM_REQUESTED, { zoom: 99 });
    h.step(600);
    expect(h.camera().zoom).toBe(ZOOM_MAX);
    h.context.events.publish(CAMERA_ZOOM_REQUESTED, { zoom: Number.NaN });
    h.step();
    const follow = h.context.world.getComponent(h.cameraEntity, CAMERA_FOLLOW);
    expect(follow?.zoomTarget).toBe(ZOOM_MAX);
  });

  it('a disabled follow configuration freezes the camera', () => {
    const h = harness();
    addPlayer(h.context.world, 300, 20);
    h.context.world.addComponent(h.cameraEntity, CAMERA_FOLLOW, {
      damping: 8,
      zoomTarget: 2,
      enabled: false,
    });
    const before = h.camera();
    h.step(60);
    expect(h.camera()).toEqual(before);
  });
});

describe('late-update ordering (AC2: after simulation resolves the position)', () => {
  it('orders the camera after movement via its declared dependency', () => {
    const registry = new ModuleRegistry();
    registry.register(createCameraPlugin()); // registered FIRST, still runs after
    registry.register(movementPlugin);
    const ids = registry.order.map((system) => system.id);
    expect(ids.indexOf('camera')).toBeGreaterThan(ids.indexOf('movement'));
  });

  it('reads the position resolved in the same step, not the previous one', () => {
    const context = makeContext();
    const player = addPlayer(context.world, 200, 90);
    const mover: System = {
      id: 'movement', // stands in for the movement System in the order
      dependencies: [],
      init() {},
      update(_dt, ctx) {
        ctx.world.addComponent(player, POSITION, { x: 210, y: 90 });
      },
      teardown() {},
    };
    const registry = new ModuleRegistry();
    const cameraPlugin = createCameraPlugin();
    registry.register(cameraPlugin);
    registry.register(mover);
    registry.initAll(context);
    const cameraEntity = context.world.query(CAMERA)[0];
    if (cameraEntity === undefined) throw new Error('no camera entity');
    context.world.addComponent(cameraEntity, CAMERA, { x: 160, y: 90, zoom: 2 });
    context.world.addComponent(cameraEntity, CAMERA_FOLLOW, {
      damping: 8,
      zoomTarget: 2,
      enabled: true,
    });

    registry.updateAll(DT, context);
    const camera = context.world.getComponent(cameraEntity, CAMERA);
    // blend = 8/60; the camera eased toward 210 (this step's resolved
    // position), not the 200 it would have seen before the mover ran.
    const expected = 160 + (210 - 160) * Math.min(1, 8 * DT);
    expect(camera?.x).toBe(expected);
  });
});

describe('end to end on a booted world', () => {
  const PACK_ROOT = '/content/pack.reference/';
  const rawFiles = import.meta.glob('/content/pack.reference/**/*.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const PACK_FILES = new Map(
    Object.entries(rawFiles).map(([path, text]) => [path.slice(PACK_ROOT.length), text]),
  );

  it('keeps the default whole-space view centered, then tracks once zoomed', () => {
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    const handle = bootWorld({ platform, packFiles: PACK_FILES, seed: 3 });
    const stop = handle.start();
    const cameraOf = () => {
      const entity = handle.world.query(CAMERA)[0];
      return entity === undefined ? undefined : handle.world.getComponent(entity, CAMERA);
    };

    const ids = handle.registry.order.map((system) => system.id);
    expect(ids.indexOf('camera')).toBeGreaterThan(ids.indexOf('movement'));

    platform.input.press('KeyD');
    for (let i = 0; i < 30; i += 1) platform.timers.tick(DT);
    // Whole-space view: bounds pin the center while the player roams (AC1).
    expect(cameraOf()).toMatchObject(CENTER);

    handle.events.publish(CAMERA_ZOOM_REQUESTED, { zoom: 2 });
    for (let i = 0; i < 240; i += 1) platform.timers.tick(DT);
    const camera = cameraOf();
    const player = handle.world.getComponent(handle.spawned.player, POSITION);
    expect(camera?.zoom).toBe(2);
    // Zoomed in, the camera has left the center and tracks the player
    // (player sits clamped at the region edge; camera at its bound).
    expect(camera?.x).toBeGreaterThan(CENTER.x);
    expect(player).toBeDefined();
    if (player !== undefined && camera !== undefined) {
      expect(Math.abs(Math.min(240, player.x) - camera.x)).toBeLessThanOrEqual(1);
    }
    stop();
  });
});
