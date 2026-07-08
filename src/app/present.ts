/**
 * Presenter for the walking skeleton: draws the active region and every
 * positioned renderable through the platform's RenderSurface, scaling the
 * fixed logical space to whatever surface the host provides — one code path
 * for desktop and mobile viewports (NFR-VIS-004).
 *
 * Presentation only reads world state; it never mutates it, so running it
 * (or not) cannot change simulation results (FR-ARCH-021's split). Colors
 * here are engine presentation defaults keyed by generic scene roles and
 * region state — no career facts (DATA-FR-027).
 */
import type { EntityStore } from '../core';
import type { RenderSurface } from '../platform';
import type { Position, Renderable } from '../systems';
import { LOGICAL_SPACE, POSITION, REGION, RENDERABLE } from '../systems';

/** Maps logical space onto a surface: uniform scale, centered letterbox. */
export interface SurfaceTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function surfaceTransform(surface: {
  readonly width: number;
  readonly height: number;
}): SurfaceTransform {
  const scale = Math.min(
    surface.width / LOGICAL_SPACE.width,
    surface.height / LOGICAL_SPACE.height,
  );
  return {
    scale,
    offsetX: (surface.width - LOGICAL_SPACE.width * scale) / 2,
    offsetY: (surface.height - LOGICAL_SPACE.height * scale) / 2,
  };
}

/** Surface pixels → logical units, clamped into the logical space. */
export function pointerToLogical(
  x: number,
  y: number,
  surface: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = surfaceTransform(surface);
  if (scale <= 0) return { x: 0, y: 0 };
  return {
    x: Math.min(LOGICAL_SPACE.width, Math.max(0, (x - offsetX) / scale)),
    y: Math.min(LOGICAL_SPACE.height, Math.max(0, (y - offsetY) / scale)),
  };
}

/** Letterbox backdrop outside the logical viewport. */
const BACKDROP_COLOR = '#06080c';
/** Region background by live state; unknown states fall back to offline. */
const REGION_COLORS: ReadonlyMap<string, string> = new Map([
  ['offline', '#131a24'],
  ['online', '#1d2b26'],
]);
const REGION_BORDER_COLOR = '#2c3a4a';
/** Fill colors by generic renderable kind. */
const KIND_COLORS: ReadonlyMap<string, string> = new Map([
  ['player', '#7ec8ff'],
  ['building', '#415062'],
  ['npc', '#c9a86a'],
]);
const FALLBACK_COLOR = '#5a6675';

/** Draw order: scenery first, the player on top. */
const KIND_LAYER: ReadonlyMap<string, number> = new Map([
  ['building', 0],
  ['npc', 1],
  ['player', 2],
]);

/** Draw one frame of the world onto the surface. */
export function present(world: EntityStore, render: RenderSurface): void {
  const size = render.size();
  const { scale, offsetX, offsetY } = surfaceTransform(size);

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

  const drawables = world
    .query(POSITION, RENDERABLE)
    .map((entity) => ({
      position: world.getComponent(entity, POSITION),
      renderable: world.getComponent(entity, RENDERABLE),
    }))
    .filter(
      (d): d is { position: Position; renderable: Renderable } =>
        d.position !== undefined && d.renderable !== undefined,
    )
    .sort(
      (a, b) =>
        (KIND_LAYER.get(a.renderable.kind) ?? 99) - (KIND_LAYER.get(b.renderable.kind) ?? 99),
    );
  for (const { position, renderable } of drawables) {
    render.fillRect(
      offsetX + (position.x - renderable.width / 2) * scale,
      offsetY + (position.y - renderable.height / 2) * scale,
      renderable.width * scale,
      renderable.height * scale,
      KIND_COLORS.get(renderable.kind) ?? FALLBACK_COLOR,
    );
  }
}
