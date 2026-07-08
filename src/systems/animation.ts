/**
 * Animation System — a sprite animation state machine driven by world state
 * (issue #21; spec: docs/16-Animation.md).
 *
 * Split across the loop's two phases like rendering: the fixed-step
 * `update` runs the state machine — deriving each animated entity's base
 * clip from the movement System's MOTION slice (moving → walk, at rest →
 * idle), advancing clip time deterministically by `dt`, and hosting
 * event-triggered one-shot clips that play once and return to the base
 * state — into the ANIMATION slice it owns (FR-ARCH-015). The presentation
 * phase calls the pure `animationPoses` helper, which interpolates clip
 * time inside the current step by the loop's alpha and resolves the current
 * frame to a sprite ref the composition root hands to rendering.
 *
 * Which imagery a clip shows is content: frames resolve through the pack's
 * asset manifest by key (`<spriteRef>.<clip>[.<direction>].<frame>`,
 * most-specific-first), so art is data and a clip the manifest does not
 * define simply falls back to the entity's base sprite (FR-ARCH-008) — the
 * engine names no career fact and ships no frame. Determinism
 * (NFR-ARCH-001): the state machine advances only by `dt` and buffered
 * events; no clocks, no randomness.
 */
import type { EntityId, EntityStore, EventPayload, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { INTENT_INTERACT } from './input';
import type { Motion } from './scene';
import { MOTION, PLAYER_CONTROLLED, RENDERABLE } from './scene';
import { ASSET_MANIFEST } from './render';

/**
 * Optional per-entity animation tuning — data, never code: frames per
 * second of clip playback and the fallback duration of a one-shot whose
 * clip has no manifest frames. Engine defaults apply when absent.
 */
export type Animatable = {
  readonly fps?: number;
  readonly oneShotSeconds?: number;
};
export const ANIMATABLE = defineComponentType<Animatable>('animatable');

/** A playing one-shot: the clip and its elapsed span within this step. */
export type OneShotState = {
  readonly clip: string;
  readonly prevElapsed: number;
  readonly elapsed: number;
  /** Seconds until the one-shot expires back to the base state. */
  readonly duration: number;
};

/**
 * The animation slice, owned by this System (FR-ARCH-015): the base clip
 * the state machine chose from world state, the clip time at the previous
 * and current fixed step (the span presentation interpolates inside), and
 * the active one-shot, if any.
 */
export type AnimationState = {
  readonly clip: string;
  readonly prevElapsed: number;
  readonly elapsed: number;
  readonly oneShot: OneShotState | null;
};
export const ANIMATION = defineComponentType<AnimationState>('animation');

/**
 * Request a one-shot clip on an entity (or on every player-controlled
 * entity when `entityId` is absent). Any System can publish this — the
 * generic channel gameplay events (interact, restore, ...) reach animation
 * through without coupling (FR-ARCH-005).
 */
export const ANIMATION_ONE_SHOT = defineEventType<{
  readonly clip: string;
  readonly entityId?: number;
}>('animation.one-shot');

/** Base clips the state machine derives from the MOTION slice. */
export const CLIP_IDLE = 'idle';
export const CLIP_WALK = 'walk';
/** The one-shot clip bound to the interact intent. */
export const CLIP_INTERACT = 'interact';

/** Engine tuning defaults; per-entity ANIMATABLE data overrides. */
export const DEFAULT_ANIMATION_FPS = 8;
export const DEFAULT_ONE_SHOT_SECONDS = 0.4;

/** Frame probing stops here so a malformed manifest cannot stall a step. */
const FRAME_PROBE_LIMIT = 64;

/** At rest with no motion slice, entities face the viewer (south). */
const DEFAULT_DIRECTION = 's';

type Manifest = { readonly [assetId: string]: string };

function manifestOf(world: EntityStore): Manifest {
  return (
    world
      .query(ASSET_MANIFEST)
      .map((entity) => world.getComponent(entity, ASSET_MANIFEST)?.entries)
      .find((entries) => entries !== undefined) ?? {}
  );
}

/** The dominant facing axis as a compass direction for frame lookup. */
export function facingDirection(motion: Motion | undefined): string {
  if (motion === undefined) return DEFAULT_DIRECTION;
  if (Math.abs(motion.facingX) > Math.abs(motion.facingY)) {
    return motion.facingX >= 0 ? 'e' : 'w';
  }
  return motion.facingY >= 0 ? 's' : 'n';
}

/** Consecutive `<prefix>.<n>` keys defined by the manifest, from zero. */
function frameCount(manifest: Manifest, prefix: string): number {
  let count = 0;
  while (count < FRAME_PROBE_LIMIT && manifest[`${prefix}.${count}`] !== undefined) count += 1;
  return count;
}

/**
 * Resolve a clip to the sprite ref for a moment of clip time,
 * most-specific-first: directional frames, directional still, plain
 * frames, plain still — and null when the manifest defines none of them,
 * so the caller falls back to the entity's base sprite (FR-ARCH-008).
 */
export function resolveClipFrame(
  manifest: Manifest,
  spriteRef: string,
  clip: string,
  direction: string,
  clipTime: number,
  fps: number,
): string | null {
  for (const prefix of [`${spriteRef}.${clip}.${direction}`, `${spriteRef}.${clip}`]) {
    const frames = frameCount(manifest, prefix);
    if (frames > 0) return `${prefix}.${Math.floor(clipTime * fps) % frames}`;
    if (manifest[prefix] !== undefined) return prefix;
  }
  return null;
}

/** A one-shot's duration: its manifest frame count over fps, or the tuned fallback. */
function oneShotDuration(
  manifest: Manifest,
  spriteRef: string,
  clip: string,
  fps: number,
  animatable: Animatable | undefined,
): number {
  const frames = frameCount(manifest, `${spriteRef}.${clip}`);
  if (frames > 0) return frames / fps;
  return animatable?.oneShotSeconds ?? DEFAULT_ONE_SHOT_SECONDS;
}

/**
 * Build the Animation System. A factory (not a shared instance) because
 * the System buffers one-shot triggers between event flush and update;
 * each booted world gets its own instance so state never bleeds across
 * worlds.
 */
export function createAnimationSystem(): System {
  interface PendingOneShot {
    readonly clip: string;
    readonly entityId: number | null;
  }
  let pendingOneShots: PendingOneShot[] = [];
  let unsubscribes: (() => void)[] = [];

  const entityIdOf = (payload: EventPayload): number | null => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const value = (payload as { readonly [key: string]: EventPayload })['entityId'];
    return typeof value === 'number' ? value : null;
  };

  return {
    id: 'animation',
    // Ordering only: read the MOTION slice movement settled this step. A
    // world without a movement System still animates idle (FR-ARCH-008).
    dependencies: ['movement'],
    init(context: SystemContext): void {
      pendingOneShots = [];
      unsubscribes.push(
        context.events.subscribe(INTENT_INTERACT, () => {
          pendingOneShots.push({ clip: CLIP_INTERACT, entityId: null });
        }),
      );
      unsubscribes.push(
        context.events.subscribe(ANIMATION_ONE_SHOT, (event) => {
          if (typeof event.payload.clip !== 'string' || event.payload.clip === '') return;
          pendingOneShots.push({ clip: event.payload.clip, entityId: entityIdOf(event.payload) });
        }),
      );
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      const manifest = manifestOf(world);

      // Resolve buffered triggers to target entities: an explicit entityId
      // targets that entity; an intent-shaped trigger (no entity) targets
      // every player-controlled entity.
      const triggered = new Map<EntityId, string>();
      if (pendingOneShots.length > 0) {
        const players = world.query(PLAYER_CONTROLLED);
        for (const pending of pendingOneShots) {
          const targets = pending.entityId === null ? players : [pending.entityId as EntityId];
          for (const target of targets) triggered.set(target, pending.clip);
        }
        pendingOneShots = [];
      }

      for (const entity of world.query(RENDERABLE)) {
        const renderable = world.getComponent(entity, RENDERABLE);
        // Only sprite-fed entities animate; a rect marker has no frames.
        if (renderable?.spriteRef === undefined) continue;
        const spriteRef = renderable.spriteRef;
        const motion = world.getComponent(entity, MOTION);
        const animatable = world.getComponent(entity, ANIMATABLE);
        const fps = animatable?.fps ?? DEFAULT_ANIMATION_FPS;
        const prior = world.getComponent(entity, ANIMATION);

        // Base state from world state, never from another System's call:
        // clip time restarts on transition and advances by dt otherwise.
        const clip = motion?.moving === true ? CLIP_WALK : CLIP_IDLE;
        const prevElapsed = prior === undefined || prior.clip !== clip ? 0 : prior.elapsed;
        const elapsed = prior === undefined || prior.clip !== clip ? 0 : prior.elapsed + dt;

        // One-shots: a trigger (re)starts the clip; an active one advances
        // and expires back to the base state once its duration passes.
        let oneShot: OneShotState | null = null;
        const trigger = triggered.get(entity);
        if (trigger !== undefined) {
          oneShot = {
            clip: trigger,
            prevElapsed: 0,
            elapsed: 0,
            duration: oneShotDuration(manifest, spriteRef, trigger, fps, animatable),
          };
        } else if (prior?.oneShot != null) {
          const advanced = prior.oneShot.elapsed + dt;
          oneShot =
            advanced >= prior.oneShot.duration
              ? null
              : { ...prior.oneShot, prevElapsed: prior.oneShot.elapsed, elapsed: advanced };
        }

        world.addComponent(entity, ANIMATION, { clip, prevElapsed, elapsed, oneShot });
      }
    },
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      pendingOneShots = [];
    },
  };
}

/**
 * Presentation-phase pose selection (pure — no world-state writes, so
 * presentation cadence cannot perturb simulation, FR-ARCH-025): for every
 * animated entity, interpolate clip time inside the current step by the
 * loop's alpha and resolve the frame's sprite ref. The composition root
 * hands the resulting map to `renderFrame`; entities that resolve no frame
 * are absent and draw their base sprite.
 */
export function animationPoses(
  alpha: number,
  context: SystemContext,
): ReadonlyMap<EntityId, string> {
  const world = context.world;
  const manifest = manifestOf(world);
  const blend = Math.min(1, Math.max(0, alpha));
  const poses = new Map<EntityId, string>();
  for (const entity of world.query(ANIMATION, RENDERABLE)) {
    const state = world.getComponent(entity, ANIMATION);
    const renderable = world.getComponent(entity, RENDERABLE);
    if (state === undefined || renderable?.spriteRef === undefined) continue;
    const active = state.oneShot ?? state;
    const clipTime = active.prevElapsed + (active.elapsed - active.prevElapsed) * blend;
    const fps = world.getComponent(entity, ANIMATABLE)?.fps ?? DEFAULT_ANIMATION_FPS;
    const frame = resolveClipFrame(
      manifest,
      renderable.spriteRef,
      active.clip,
      facingDirection(world.getComponent(entity, MOTION)),
      clipTime,
      fps,
    );
    if (frame !== null) poses.set(entity, frame);
  }
  return poses;
}

/**
 * The animation plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createAnimationPlugin(): Plugin {
  return {
    id: 'plugin.animation',
    systems: [createAnimationSystem()],
    componentTypes: [ANIMATION, ANIMATABLE],
    eventTypes: [ANIMATION_ONE_SHOT],
  };
}
