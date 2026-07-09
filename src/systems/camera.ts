/**
 * Camera System — a late-update System that owns the CAMERA view slice
 * (issue #18; spec: docs/13-Camera.md): each fixed step, after simulation
 * has resolved the player's position, it eases the view center toward its
 * follow target with damping, eases zoom toward the requested level, and
 * clamps the center so the view never leaves the region extents.
 *
 * Ordering is its whole contract with the rest of the frame: the declared
 * `movement` dependency runs this System after the position it follows has
 * settled (docs/02, "Late update"), and rendering consumes the CAMERA
 * component at presentation — the camera never talks to the renderer.
 *
 * Determinism (NFR-ARCH-001): easing is a linear blend (`min(1, damping
 * * dt)`), built only from IEEE-exact arithmetic — no `Math.exp`, whose
 * rounding may differ across hosts — so identical sessions produce
 * identical camera paths. The blend factor never exceeds 1, so the camera
 * approaches its target monotonically and cannot overshoot or oscillate.
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { THEME } from '../style';
import { reducedMotionOf } from './accessibility';
import type { Camera } from './render';
import { CAMERA } from './render';
import { LOGICAL_SPACE, PLAYER_CONTROLLED, POSITION } from './scene';

/**
 * The follow configuration slice, owned by the Camera System alongside
 * CAMERA itself (FR-ARCH-015): damping in 1/seconds (higher snaps faster),
 * the zoom level being eased toward, and an enable switch so cinematic or
 * debugging code can freeze the camera by writing data, not by reaching
 * into the System.
 */
export type CameraFollow = {
  readonly damping: number;
  readonly zoomTarget: number;
  readonly enabled: boolean;
};
export const CAMERA_FOLLOW = defineComponentType<CameraFollow>('camera-follow');

/** Engine defaults: responsive follow (the theme's motion token,
 * FR-ART-005), whole-space view. */
export const DEFAULT_CAMERA_FOLLOW: CameraFollow = {
  damping: THEME.motion.cameraFollowDamping,
  zoomTarget: 1,
  enabled: true,
};

/**
 * The zoom hook (deliverable): any System requests a zoom level by
 * publishing this event; the Camera System clamps it and eases toward it.
 */
export const CAMERA_ZOOM_REQUESTED = defineEventType<{ readonly zoom: number }>('camera.zoom');

/** Zoom limits: 1 shows the whole region; deeper than 4 loses context. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

/** Below this remaining distance the camera lands exactly on target. */
const SNAP_EPSILON = 1e-3;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Clamp the view center so the visible span stays inside the region
 * extents. Under the whole-space fit the visible logical span at zoom `z`
 * is the logical space over `z`, so the center may roam the inset
 * rectangle `[span/2, extent - span/2]` per axis — which collapses to the
 * region center at zoom 1, where everything is already visible.
 */
export function clampToRegionExtents(x: number, y: number, zoom: number): { x: number; y: number } {
  const halfVisibleWidth = LOGICAL_SPACE.width / (2 * zoom);
  const halfVisibleHeight = LOGICAL_SPACE.height / (2 * zoom);
  return {
    x: clamp(x, halfVisibleWidth, LOGICAL_SPACE.width - halfVisibleWidth),
    y: clamp(y, halfVisibleHeight, LOGICAL_SPACE.height - halfVisibleHeight),
  };
}

/** The follow target: the player's resolved position, or null when absent. */
function followTarget(world: EntityStore): { x: number; y: number } | null {
  for (const entity of world.query(POSITION, PLAYER_CONTROLLED)) {
    const position = world.getComponent(entity, POSITION);
    if (position !== undefined) return position;
  }
  return null;
}

/** One damped step toward a target: monotonic, never overshooting. */
function ease(current: number, target: number, blend: number): number {
  const next = current + (target - current) * blend;
  return Math.abs(target - next) < SNAP_EPSILON ? target : next;
}

/**
 * Build the Camera System. A factory because it buffers zoom requests
 * between the tick's event flush and its own update; each booted world
 * gets an independent instance.
 */
export function createCameraSystem(): System {
  let pendingZoom: number | null = null;
  let unsubscribe: (() => void) | null = null;
  let cameraEntity: EntityId | null = null;

  return {
    id: 'camera',
    // Late update (AC2): run after simulation has settled the position this
    // camera follows. Ordering only — a world without a movement System
    // still gets a working camera (FR-ARCH-008).
    dependencies: ['movement'],
    init(context: SystemContext): void {
      pendingZoom = null;
      // Adopt the world's camera entity, or create one framing the region
      // center, and ensure it carries a follow configuration.
      cameraEntity = context.world.query(CAMERA)[0] ?? null;
      if (cameraEntity === null) {
        cameraEntity = context.world.createEntity();
        context.world.addComponent(cameraEntity, CAMERA, {
          x: LOGICAL_SPACE.width / 2,
          y: LOGICAL_SPACE.height / 2,
          zoom: 1,
        });
      }
      if (context.world.getComponent(cameraEntity, CAMERA_FOLLOW) === undefined) {
        context.world.addComponent(cameraEntity, CAMERA_FOLLOW, DEFAULT_CAMERA_FOLLOW);
      }
      unsubscribe = context.events.subscribe(CAMERA_ZOOM_REQUESTED, (event) => {
        if (typeof event.payload.zoom === 'number' && Number.isFinite(event.payload.zoom)) {
          pendingZoom = event.payload.zoom;
        }
      });
    },
    update(dt: number, context: SystemContext): void {
      if (cameraEntity === null) return;
      const world = context.world;
      const camera = world.getComponent(cameraEntity, CAMERA);
      let follow = world.getComponent(cameraEntity, CAMERA_FOLLOW);
      if (camera === undefined || follow === undefined) return;

      if (pendingZoom !== null) {
        follow = { ...follow, zoomTarget: clamp(pendingZoom, ZOOM_MIN, ZOOM_MAX) };
        world.addComponent(cameraEntity, CAMERA_FOLLOW, follow);
        pendingZoom = null;
      }
      if (!follow.enabled) return;

      // Reduced motion (docs/34): the view lands instantly instead of
      // easing — same targets, no travel (NFR-ART-003).
      const blend = reducedMotionOf(world) ? 1 : Math.min(1, follow.damping * dt);
      const target = followTarget(world) ?? {
        x: LOGICAL_SPACE.width / 2,
        y: LOGICAL_SPACE.height / 2,
      };
      const zoom = ease(camera.zoom, clamp(follow.zoomTarget, ZOOM_MIN, ZOOM_MAX), blend);
      const centered = clampToRegionExtents(
        ease(camera.x, target.x, blend),
        ease(camera.y, target.y, blend),
        zoom,
      );
      const next: Camera = { x: centered.x, y: centered.y, zoom };
      if (next.x !== camera.x || next.y !== camera.y || next.zoom !== camera.zoom) {
        world.addComponent(cameraEntity, CAMERA, next);
      }
    },
    teardown(): void {
      unsubscribe?.();
      unsubscribe = null;
      pendingZoom = null;
      cameraEntity = null;
    },
  };
}

/**
 * The camera plugin: the System plus the follow-configuration component and
 * the zoom-request event it introduces (FR-ARCH-018). CAMERA itself is
 * defined with rendering's types; this System is its writer.
 */
export function createCameraPlugin(): Plugin {
  return {
    id: 'plugin.camera',
    systems: [createCameraSystem()],
    componentTypes: [CAMERA_FOLLOW],
    eventTypes: [CAMERA_ZOOM_REQUESTED],
  };
}
