import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { createHeadlessPlatform } from '../platform';
import type { Camera } from './render';
import {
  ASSET_MANIFEST,
  CAMERA,
  RENDER_MOTION,
  renderFrame,
  renderSystem,
  viewTransform,
} from './render';
import { LOGICAL_SPACE, POSITION, REGION, RENDERABLE } from './scene';

const DT = 1 / 60;

function makeContext(): SystemContext {
  return {
    world: new EntityStore(),
    events: new EventBus(),
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
}

/** A 640×360 surface fits the 320×180 logical space at exactly 2×, no offsets. */
function makeSurface() {
  return createHeadlessPlatform({ width: 640, height: 360 }).render;
}

function addDrawable(
  world: EntityStore,
  x: number,
  y: number,
  renderable: { kind: string; width: number; height: number; layer?: number; spriteRef?: string },
) {
  const entity = world.createEntity();
  world.addComponent(entity, POSITION, { x, y });
  world.addComponent(entity, RENDERABLE, renderable);
  return entity;
}

function drawnRects(render: ReturnType<typeof makeSurface>) {
  // Drop the region background (the first fillRect after clear).
  return render.commands.filter((c) => c['op'] === 'fillRect').slice(1);
}

describe('renderSystem.update', () => {
  it('captures per-entity motion spans across fixed steps', () => {
    const context = makeContext();
    const entity = addDrawable(context.world, 10, 20, { kind: 'player', width: 4, height: 4 });

    renderSystem.update(DT, context);
    expect(context.world.getComponent(entity, RENDER_MOTION)).toEqual({
      prevX: 10,
      prevY: 20,
      x: 10,
      y: 20,
    });

    context.world.addComponent(entity, POSITION, { x: 14, y: 20 });
    renderSystem.update(DT, context);
    expect(context.world.getComponent(entity, RENDER_MOTION)).toEqual({
      prevX: 10,
      prevY: 20,
      x: 14,
      y: 20,
    });
  });
});

describe('renderFrame', () => {
  it('draws entities at their positions under the default whole-space fit', () => {
    const context = makeContext();
    addDrawable(context.world, 100, 50, { kind: 'player', width: 10, height: 10 });
    const render = makeSurface();

    renderFrame(0, context, render);

    expect(render.commands[0]).toMatchObject({ op: 'clear' });
    expect(drawnRects(render)).toEqual([
      {
        op: 'fillRect',
        x: (100 - 5) * 2,
        y: (50 - 5) * 2,
        width: 20,
        height: 20,
        color: '#7ec8ff',
      },
    ]);
  });

  it('interpolates between the previous and current fixed step by alpha (FR-ARCH-021)', () => {
    const context = makeContext();
    const entity = addDrawable(context.world, 10, 20, { kind: 'player', width: 4, height: 4 });
    renderSystem.update(DT, context);
    context.world.addComponent(entity, POSITION, { x: 14, y: 20 });
    renderSystem.update(DT, context);

    const render = makeSurface();
    renderFrame(0.5, context, render);
    // Halfway between 10 and 14 is 12; centered and scaled 2x: (12-2)*2 = 20.
    expect(drawnRects(render)[0]).toMatchObject({ x: 20 });

    render.reset();
    renderFrame(0, context, render);
    expect(drawnRects(render)[0]).toMatchObject({ x: (10 - 2) * 2 });
  });

  it('orders draws by layer with stable insertion-order ties', () => {
    const context = makeContext();
    // Insertion order: npc (layer 10), building (0), player (20), then two
    // explicit same-layer entities to prove the stable tiebreak.
    addDrawable(context.world, 50, 50, { kind: 'npc', width: 2, height: 2 });
    addDrawable(context.world, 60, 50, { kind: 'building', width: 2, height: 2 });
    addDrawable(context.world, 70, 50, { kind: 'player', width: 2, height: 2 });
    addDrawable(context.world, 80, 50, { kind: 'npc', width: 2, height: 2, layer: 10 });
    addDrawable(context.world, 90, 50, { kind: 'player', width: 2, height: 2, layer: 0 });

    const render = makeSurface();
    renderFrame(0, context, render);
    const xs = drawnRects(render).map((rect) => rect['x']);
    // building(60), player-with-layer-0(90) [insertion tiebreak], npc(50),
    // npc-explicit(80), player(70).
    expect(xs).toEqual([(60 - 1) * 2, (90 - 1) * 2, (50 - 1) * 2, (80 - 1) * 2, (70 - 1) * 2]);
  });

  it('draws through the active camera: centered view, zoom scales the fit', () => {
    const context = makeContext();
    addDrawable(context.world, 80, 45, { kind: 'player', width: 10, height: 10 });
    const cameraEntity = context.world.createEntity();
    context.world.addComponent(cameraEntity, CAMERA, { x: 80, y: 45, zoom: 2 });

    const render = makeSurface();
    renderFrame(0, context, render);
    // fit scale 2 × zoom 2 = 4; the camera target lands at the surface
    // center (320, 180), so the 10-unit sprite spans 40px around it.
    expect(drawnRects(render)[0]).toMatchObject({
      x: 320 - 20,
      y: 180 - 20,
      width: 40,
      height: 40,
    });
  });

  it('falls back to the whole-space fit when no camera entity exists', () => {
    const surface = { width: 640, height: 360 };
    const centered: Camera = {
      x: LOGICAL_SPACE.width / 2,
      y: LOGICAL_SPACE.height / 2,
      zoom: 1,
    };
    expect(viewTransform(surface, centered)).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
  });

  it('draws sprites resolved through the asset manifest, rects otherwise (FR-ARCH-008)', () => {
    const context = makeContext();
    const manifest = context.world.createEntity();
    context.world.addComponent(manifest, ASSET_MANIFEST, {
      entries: { 'asset.known': 'data:image/png;base64,AA==' },
    });
    addDrawable(context.world, 50, 50, {
      kind: 'npc',
      width: 8,
      height: 12,
      spriteRef: 'asset.known',
    });
    addDrawable(context.world, 90, 50, {
      kind: 'npc',
      width: 8,
      height: 12,
      spriteRef: 'asset.missing',
    });

    const render = makeSurface();
    renderFrame(0, context, render);
    const sprites = render.commands.filter((c) => c['op'] === 'drawSprite');
    expect(sprites).toEqual([
      {
        op: 'drawSprite',
        assetRef: 'data:image/png;base64,AA==',
        x: (50 - 4) * 2,
        y: (50 - 6) * 2,
        width: 16,
        height: 24,
      },
    ]);
    // The unresolved ref degrades to the kind-colored rect, never a fault.
    expect(drawnRects(render)).toHaveLength(1);
  });

  it('reflects the region state in the background color', () => {
    const context = makeContext();
    const region = context.world.createEntity();
    context.world.addComponent(region, REGION, { contentId: 'region.example', state: 'online' });
    const render = makeSurface();
    renderFrame(0, context, render);
    const background = render.commands.filter((c) => c['op'] === 'fillRect')[0];
    expect(background).toMatchObject({ color: '#1d2b26' });
  });

  it('renders in a world with no movement System registered (FR-ARCH-008)', () => {
    // The render System's `movement` dependency is ordering only: alone in
    // the world it still captures motion and draws.
    const context = makeContext();
    const entity = addDrawable(context.world, 10, 10, { kind: 'player', width: 2, height: 2 });
    renderSystem.update(DT, context);
    const render = makeSurface();
    expect(() => renderFrame(0.25, context, render)).not.toThrow();
    expect(context.world.getComponent(entity, RENDER_MOTION)).toBeDefined();
    expect(drawnRects(render)).toHaveLength(1);
  });
});
