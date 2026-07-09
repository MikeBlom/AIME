/**
 * Rendering System — draws every positioned Renderable through the platform
 * adapter's RenderSurface (issue #16; spec: docs/30-Rendering.md).
 *
 * Split across the loop's two phases (FR-ARCH-021): the fixed-step `update`
 * only captures per-entity motion spans (previous → current position) into
 * its owned RENDER_MOTION slice (FR-ARCH-015); the variable-step
 * `renderFrame` — invoked by the composition root during presentation —
 * interpolates inside that span by the loop's alpha, so motion is smooth at
 * any frame rate without touching simulation state.
 *
 * The System reads only world state and the adapter surface: layering is
 * data (`Renderable.layer`, defaulting by kind), the view is data (the
 * first CAMERA entity, defaulting to a whole-space fit), and sprites
 * resolve through the pack's asset manifest in world state (FR-REND-007).
 * It holds no reference to any other System; its `movement` dependency is
 * ordering only and is tolerated absent (FR-ARCH-008).
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType } from '../core';
import type { RenderSurface } from '../platform';
import { THEME } from '../style';
import { reducedMotionOf } from './accessibility';
import type { Position, Renderable } from './scene';
import {
  activeSpaceOf,
  fitTransform,
  LOGICAL_SPACE,
  POSITION,
  REGION,
  RENDERABLE,
  spaceOf,
} from './scene';

/**
 * The view: logical center the surface looks at plus a zoom multiplier on
 * the whole-space fit scale. Absent any camera entity, rendering defaults
 * to the centered whole-space fit.
 */
export type Camera = { readonly x: number; readonly y: number; readonly zoom: number };
export const CAMERA = defineComponentType<Camera>('camera');

/**
 * One fixed step's motion span, owned by the render System: where the
 * entity was at the previous step and where it is now. Presentation
 * interpolates between the two (FR-ARCH-021).
 */
export type RenderMotion = {
  readonly prevX: number;
  readonly prevY: number;
  readonly x: number;
  readonly y: number;
};
export const RENDER_MOTION = defineComponentType<RenderMotion>('render-motion');

/** The pack's asset manifest (asset id → address), landed at spawn. */
export type AssetManifest = { readonly entries: { readonly [assetId: string]: string } };
export const ASSET_MANIFEST = defineComponentType<AssetManifest>('asset-manifest');

/**
 * The environment lighting hook: a translucent overlay color drawn above
 * the world (null = no overlay). Defined here like CAMERA — rendering owns
 * the vocabulary it consumes — and written by the environment System,
 * which owns the value (FR-ARCH-015). Rendering tolerates its absence
 * entirely (FR-ARCH-008).
 */
export type EnvironmentLight = { readonly tint: string | null };
export const ENVIRONMENT_LIGHT = defineComponentType<EnvironmentLight>('environment-light');

/** Default draw layer per generic renderable kind; `layer` overrides. */
const KIND_LAYERS: ReadonlyMap<string, number> = new Map([
  ['building', 0],
  ['wall', 0],
  ['doorway', 1],
  ['furnishing', 2],
  ['poi', 3],
  ['npc', 10],
  ['player', 20],
]);
const FALLBACK_LAYER = 5;

/**
 * Every color below resolves from the theme by named role (FR-ART-001);
 * this System owns which role each drawn thing plays, never the values.
 */
const BACKDROP_COLOR = THEME.palette.backdrop;
/** Region background by live state; unknown states fall back to offline. */
const REGION_COLORS: ReadonlyMap<string, string> = new Map([
  ['offline', THEME.palette.regionOffline],
  ['online', THEME.palette.regionOnline],
]);
const REGION_BORDER_COLOR = THEME.palette.regionBorder;
/** Fill per generic renderable kind (rect fallback when no sprite). A Map
 * so content-supplied kind strings never resolve prototype members. */
const KIND_COLORS: ReadonlyMap<string, string> = new Map(Object.entries(THEME.palette.kind));
const FALLBACK_COLOR = THEME.palette.kindFallback;
/** Space-transition cover color (rgb of the backdrop; alpha varies). */
const TRANSITION_RGB = THEME.palette.transitionRgb;

export const renderSystem: System = {
  id: 'render',
  // Ordering only: capture motion after movement has settled the step.
  // A world without a movement System still renders (FR-ARCH-008).
  dependencies: ['movement'],
  init() {},
  update(_dt: number, context: SystemContext): void {
    for (const entity of context.world.query(POSITION, RENDERABLE)) {
      const position = context.world.getComponent(entity, POSITION);
      if (position === undefined) continue;
      const motion = context.world.getComponent(entity, RENDER_MOTION);
      context.world.addComponent(entity, RENDER_MOTION, {
        prevX: motion?.x ?? position.x,
        prevY: motion?.y ?? position.y,
        x: position.x,
        y: position.y,
      });
    }
  },
  teardown() {},
};

/** The active view: the first CAMERA entity, or the whole-space default. */
function activeCamera(world: EntityStore): Camera {
  for (const entity of world.query(CAMERA)) {
    const camera = world.getComponent(entity, CAMERA);
    if (camera !== undefined) return camera;
  }
  return { x: LOGICAL_SPACE.width / 2, y: LOGICAL_SPACE.height / 2, zoom: 1 };
}

/**
 * The camera-aware view transform: the whole-space fit scale times the
 * camera zoom, positioned so the camera's center lands at the surface
 * center. A centered zoom-1 camera reproduces the letterboxed fit exactly.
 */
export function viewTransform(
  surface: { readonly width: number; readonly height: number },
  camera: Camera,
): { scale: number; offsetX: number; offsetY: number } {
  const scale = fitTransform(surface).scale * camera.zoom;
  return {
    scale,
    offsetX: surface.width / 2 - camera.x * scale,
    offsetY: surface.height / 2 - camera.y * scale,
  };
}

function layerOf(renderable: Renderable): number {
  return renderable.layer ?? KIND_LAYERS.get(renderable.kind) ?? FALLBACK_LAYER;
}

/** Interpolated draw position for this frame (FR-ARCH-021). */
function drawPosition(
  position: Position,
  motion: RenderMotion | undefined,
  alpha: number,
): { x: number; y: number } {
  if (motion === undefined) return { x: position.x, y: position.y };
  return {
    x: motion.prevX + (motion.x - motion.prevX) * alpha,
    y: motion.prevY + (motion.y - motion.prevY) * alpha,
  };
}

/**
 * Draw one presentation frame: region background, then every positioned
 * Renderable in stable layer order (layer ascending, insertion order as
 * the tiebreak), each at its interpolated position, as a sprite when its
 * `spriteRef` resolves through the asset manifest and as a kind-colored
 * rect otherwise. Reads only world state and the surface. An optional
 * `poses` map (the Animation System's presentation output, handed over by
 * the composition root) overrides an entity's sprite ref for this frame;
 * rendering tolerates its absence entirely (FR-ARCH-008).
 */
export function renderFrame(
  alpha: number,
  context: SystemContext,
  render: RenderSurface,
  poses?: ReadonlyMap<EntityId, string>,
): void {
  const world = context.world;
  const { scale, offsetX, offsetY } = viewTransform(render.size(), activeCamera(world));

  render.clear(BACKDROP_COLOR);
  const regionState =
    world
      .query(REGION)
      .map((entity) => world.getComponent(entity, REGION)?.state)
      .find((state) => state !== undefined) ?? 'offline';
  render.fillRect(
    offsetX,
    offsetY,
    LOGICAL_SPACE.width * scale,
    LOGICAL_SPACE.height * scale,
    REGION_COLORS.get(regionState) ?? (REGION_COLORS.get('offline') as string),
  );
  render.drawLine(
    offsetX,
    offsetY,
    offsetX + LOGICAL_SPACE.width * scale,
    offsetY,
    REGION_BORDER_COLOR,
  );
  render.drawLine(
    offsetX,
    offsetY + LOGICAL_SPACE.height * scale,
    offsetX + LOGICAL_SPACE.width * scale,
    offsetY + LOGICAL_SPACE.height * scale,
    REGION_BORDER_COLOR,
  );

  const manifest =
    world
      .query(ASSET_MANIFEST)
      .map((entity) => world.getComponent(entity, ASSET_MANIFEST)?.entries)
      .find((entries) => entries !== undefined) ?? {};

  // Only the active space's population draws: the exterior while outdoors,
  // one interior while inside (issue #30); other spaces coexist unseen.
  const activeSpace = activeSpaceOf(world);
  const drawables = world
    .query(POSITION, RENDERABLE)
    .filter((entity) => spaceOf(world, entity) === activeSpace.space)
    .map((entity) => ({
      entity,
      position: world.getComponent(entity, POSITION),
      renderable: world.getComponent(entity, RENDERABLE),
      motion: world.getComponent(entity, RENDER_MOTION),
    }))
    .filter(
      (
        d,
      ): d is {
        entity: EntityId;
        position: Position;
        renderable: Renderable;
        motion: RenderMotion | undefined;
      } => d.position !== undefined && d.renderable !== undefined,
    )
    // Array.sort is stable: equal layers keep world insertion order, so
    // layering never flickers between frames.
    .sort((a, b) => layerOf(a.renderable) - layerOf(b.renderable));

  for (const { entity, position, renderable, motion } of drawables) {
    const at = drawPosition(position, motion, alpha);
    const x = offsetX + (at.x - renderable.width / 2) * scale;
    const y = offsetY + (at.y - renderable.height / 2) * scale;
    const width = renderable.width * scale;
    const height = renderable.height * scale;
    const spriteRef = poses?.get(entity) ?? renderable.spriteRef;
    const address = spriteRef === undefined ? undefined : manifest[spriteRef];
    if (address !== undefined) {
      render.drawSprite(address, x, y, width, height);
    } else {
      render.fillRect(x, y, width, height, KIND_COLORS.get(renderable.kind) ?? FALLBACK_COLOR);
    }
  }

  // The environment lighting overlay (issue #29): a translucent tint above
  // the world, below UI. Absent or null draws nothing.
  const tint =
    world
      .query(ENVIRONMENT_LIGHT)
      .map((entity) => world.getComponent(entity, ENVIRONMENT_LIGHT)?.tint)
      .find((value) => value !== undefined) ?? null;
  if (tint !== null) {
    render.fillRect(
      offsetX,
      offsetY,
      LOGICAL_SPACE.width * scale,
      LOGICAL_SPACE.height * scale,
      tint,
    );
  }

  // The space-transition cover (issue #30): fade to full dark toward the
  // swap at the transition's midpoint, then back in — the polish that hides
  // the population change. Reads world state only; absent draws nothing.
  // Reduced motion (docs/34): the cover holds fully dark for the whole
  // transition — a clean cut instead of an animated fade (NFR-ART-003).
  if (activeSpace.transition !== null) {
    const progress = activeSpace.transition.progress;
    const alpha = reducedMotionOf(world)
      ? 1
      : Math.min(1, Math.max(0, progress < 0.5 ? progress * 2 : (1 - progress) * 2));
    if (alpha > 0) {
      const surface = render.size();
      render.fillRect(0, 0, surface.width, surface.height, `rgba(${TRANSITION_RGB}, ${alpha})`);
    }
  }
}

/**
 * The rendering plugin: the System plus the component types it introduces,
 * registered and removed as one unit (FR-ARCH-018).
 */
export const renderPlugin: Plugin = {
  id: 'plugin.render',
  systems: [renderSystem],
  componentTypes: [CAMERA, RENDER_MOTION, ASSET_MANIFEST, ENVIRONMENT_LIGHT],
};
