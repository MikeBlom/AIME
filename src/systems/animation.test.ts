/**
 * Animation System suite (issue #21): the state machine follows world
 * state, never direct System calls (AC1), transitions restart clip time
 * smoothly and presentation interpolates inside the fixed step (AC1), and
 * event-triggered one-shots play on the right events and return to the
 * base state (AC2). Frame resolution is content: everything arrives
 * through the asset manifest.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { createHeadlessPlatform } from '../platform';
import {
  ANIMATABLE,
  ANIMATION,
  ANIMATION_ONE_SHOT,
  animationPoses,
  CLIP_IDLE,
  CLIP_INTERACT,
  CLIP_WALK,
  createAnimationSystem,
  DEFAULT_ANIMATION_FPS,
  DEFAULT_ONE_SHOT_SECONDS,
  facingDirection,
  resolveClipFrame,
} from './animation';
import { ACCESSIBILITY_SETTINGS, DEFAULT_ACCESSIBILITY_SETTINGS } from './accessibility';
import { INTENT_INTERACT } from './input';
import { ASSET_MANIFEST, renderFrame } from './render';
import type { Motion } from './scene';
import { IDLE_MOTION, MOTION, PLAYER_CONTROLLED, POSITION, RENDERABLE } from './scene';

const DT = 1 / 60;

interface Harness {
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly context: SystemContext;
  readonly system: ReturnType<typeof createAnimationSystem>;
  /** One simulated fixed step: flush deferred events, then update. */
  step(): void;
}

function harness(): Harness {
  const world = new EntityStore();
  const events = new EventBus({ logEnabled: false });
  const context: SystemContext = {
    world,
    events,
    scheduler: { schedule: (task: () => void) => task() },
    platform: createHeadlessPlatform(),
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const system = createAnimationSystem();
  system.init(context);
  return {
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

const MOVING_EAST: Motion = {
  moving: true,
  velocityX: 96,
  velocityY: 0,
  facingX: 1,
  facingY: 0,
};

function addAnimated(
  world: EntityStore,
  spriteRef: string,
  options?: { motion?: Motion; player?: boolean },
): EntityId {
  const entity = world.createEntity();
  world.addComponent(entity, POSITION, { x: 160, y: 90 });
  world.addComponent(entity, RENDERABLE, { kind: 'player', width: 10, height: 10, spriteRef });
  if (options?.motion !== undefined) world.addComponent(entity, MOTION, options.motion);
  if (options?.player === true) world.addComponent(entity, PLAYER_CONTROLLED, { speed: 96 });
  return entity;
}

describe('state machine driven by world state (AC1)', () => {
  it('derives idle at rest and walk in motion, purely from the MOTION slice', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { motion: IDLE_MOTION });
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.clip).toBe(CLIP_IDLE);

    h.world.addComponent(entity, MOTION, MOVING_EAST);
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.clip).toBe(CLIP_WALK);

    h.world.addComponent(entity, MOTION, IDLE_MOTION);
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.clip).toBe(CLIP_IDLE);
  });

  it('an entity with no MOTION slice animates idle (FR-ARCH-008)', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'marker');
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.clip).toBe(CLIP_IDLE);
  });

  it('an entity with no sprite ref carries no animation state', () => {
    const h = harness();
    const entity = h.world.createEntity();
    h.world.addComponent(entity, RENDERABLE, { kind: 'player', width: 10, height: 10 });
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)).toBeUndefined();
  });

  it('clip time advances by dt within a clip and restarts on transition', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { motion: IDLE_MOTION });
    // Step 1 enters the clip at time zero; each later step advances by dt.
    h.step();
    h.step();
    h.step();
    const idling = h.world.getComponent(entity, ANIMATION);
    expect(idling?.prevElapsed).toBeCloseTo(DT, 10);
    expect(idling?.elapsed).toBeCloseTo(2 * DT, 10);

    h.world.addComponent(entity, MOTION, MOVING_EAST);
    h.step();
    const walking = h.world.getComponent(entity, ANIMATION);
    expect(walking?.clip).toBe(CLIP_WALK);
    expect(walking?.prevElapsed).toBe(0);
    expect(walking?.elapsed).toBe(0);
  });

  it('two runs over identical inputs produce identical animation state (determinism)', () => {
    const run = () => {
      const h = harness();
      const entity = addAnimated(h.world, 'hero', { motion: IDLE_MOTION, player: true });
      h.step();
      h.world.addComponent(entity, MOTION, MOVING_EAST);
      h.step();
      h.events.publish(INTENT_INTERACT, {});
      h.step();
      h.step();
      return h.world.getComponent(entity, ANIMATION);
    };
    expect(run()).toEqual(run());
  });
});

describe('presentation pose resolution', () => {
  it('resolves manifest frames by clip time and fps, cycling the frame count', () => {
    const manifest = {
      'hero.walk.0': 'assets/w0.png',
      'hero.walk.1': 'assets/w1.png',
    };
    expect(resolveClipFrame(manifest, 'hero', 'walk', 's', 0, DEFAULT_ANIMATION_FPS)).toBe(
      'hero.walk.0',
    );
    // One frame lasts 1/fps seconds; the third frame wraps back to zero.
    expect(resolveClipFrame(manifest, 'hero', 'walk', 's', 1 / 8, 8)).toBe('hero.walk.1');
    expect(resolveClipFrame(manifest, 'hero', 'walk', 's', 2 / 8, 8)).toBe('hero.walk.0');
  });

  it('prefers directional frames, then directional still, then plain, then null', () => {
    expect(
      resolveClipFrame({ 'hero.walk.e.0': 'a', 'hero.walk.0': 'b' }, 'hero', 'walk', 'e', 0, 8),
    ).toBe('hero.walk.e.0');
    expect(
      resolveClipFrame({ 'hero.walk.e': 'a', 'hero.walk': 'b' }, 'hero', 'walk', 'e', 0, 8),
    ).toBe('hero.walk.e');
    expect(resolveClipFrame({ 'hero.walk': 'b' }, 'hero', 'walk', 'e', 0, 8)).toBe('hero.walk');
    expect(resolveClipFrame({}, 'hero', 'walk', 'e', 0, 8)).toBeNull();
  });

  it('maps facing to the dominant compass axis, defaulting south', () => {
    expect(facingDirection(undefined)).toBe('s');
    expect(facingDirection(IDLE_MOTION)).toBe('s');
    expect(facingDirection(MOVING_EAST)).toBe('e');
    expect(facingDirection({ ...IDLE_MOTION, facingX: -1, facingY: 0 })).toBe('w');
    expect(facingDirection({ ...IDLE_MOTION, facingX: 0, facingY: -1 })).toBe('n');
  });

  it('interpolates clip time inside the step by alpha (presentation-phase interpolation)', () => {
    const h = harness();
    // At 45 fps a frame lasts ~0.0222s, so the frame edge falls strictly
    // inside a 1/60s step — no floating-point knife edge.
    const entity = addAnimated(h.world, 'hero', { motion: IDLE_MOTION });
    h.world.addComponent(entity, ANIMATABLE, { fps: 45 });
    addManifest(h.world, {
      'hero.idle.0': 'assets/i0.png',
      'hero.idle.1': 'assets/i1.png',
    });
    // Step 1 enters the clip at time zero; two more steps put the span at
    // [DT, 2*DT] = [0.0167, 0.0333], straddling the 0.0222 frame edge.
    h.step();
    h.step();
    h.step();
    expect(animationPoses(0, h.context).get(entity)).toBe('hero.idle.0');
    expect(animationPoses(1, h.context).get(entity)).toBe('hero.idle.1');
  });

  it('an entity whose clip resolves nothing is absent from the pose map', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { motion: IDLE_MOTION });
    addManifest(h.world, { hero: 'assets/hero.png' });
    h.step();
    expect(animationPoses(0, h.context).has(entity)).toBe(false);
  });

  it('poses never write world state (presentation cadence cannot perturb simulation)', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { motion: IDLE_MOTION });
    addManifest(h.world, { 'hero.idle.0': 'assets/i0.png' });
    h.step();
    const before = h.world.getComponent(entity, ANIMATION);
    animationPoses(0.5, h.context);
    animationPoses(0.9, h.context);
    expect(h.world.getComponent(entity, ANIMATION)).toBe(before);
  });
});

describe('event-triggered one-shots (AC2)', () => {
  it('the interact intent plays the interact clip on player-controlled entities and returns to base', () => {
    const h = harness();
    const player = addAnimated(h.world, 'hero', { motion: IDLE_MOTION, player: true });
    const bystander = addAnimated(h.world, 'npc', { motion: IDLE_MOTION });
    addManifest(h.world, {
      'hero.interact.0': 'assets/x0.png',
      'hero.interact.1': 'assets/x1.png',
      'hero.idle.0': 'assets/i0.png',
    });
    h.events.publish(INTENT_INTERACT, {});
    h.step();

    const during = h.world.getComponent(player, ANIMATION);
    expect(during?.oneShot?.clip).toBe(CLIP_INTERACT);
    expect(h.world.getComponent(bystander, ANIMATION)?.oneShot).toBeNull();
    expect(animationPoses(0, h.context).get(player)).toBe('hero.interact.0');

    // Two manifest frames at the default fps: expires after 2/fps seconds.
    const duration = 2 / DEFAULT_ANIMATION_FPS;
    for (let i = 0; i < Math.ceil(duration / DT) + 1; i += 1) h.step();
    const after = h.world.getComponent(player, ANIMATION);
    expect(after?.oneShot).toBeNull();
    expect(after?.clip).toBe(CLIP_IDLE);
    expect(animationPoses(0, h.context).get(player)).toBe('hero.idle.0');
  });

  it('a generic one-shot event with an entityId targets exactly that entity', () => {
    const h = harness();
    const target = addAnimated(h.world, 'npc');
    const other = addAnimated(h.world, 'npc2');
    h.events.publish(ANIMATION_ONE_SHOT, { clip: 'restore', entityId: target });
    h.step();
    expect(h.world.getComponent(target, ANIMATION)?.oneShot?.clip).toBe('restore');
    expect(h.world.getComponent(other, ANIMATION)?.oneShot).toBeNull();
  });

  it('a one-shot with no manifest frames uses the tuned or default duration', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { player: true });
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.oneShot?.duration).toBe(
      DEFAULT_ONE_SHOT_SECONDS,
    );

    h.world.addComponent(entity, ANIMATABLE, { oneShotSeconds: 0.1 });
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.oneShot?.duration).toBeCloseTo(0.1, 10);
  });

  it('a retrigger restarts the one-shot; a malformed payload is ignored', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { player: true });
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.oneShot?.elapsed).toBeCloseTo(DT, 10);

    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.oneShot?.elapsed).toBe(0);

    h.events.publish(ANIMATION_ONE_SHOT, { clip: '' });
    expect(() => h.step()).not.toThrow();
  });

  it('unsubscribes on teardown: later events no longer reach the machine', () => {
    const h = harness();
    const entity = addAnimated(h.world, 'hero', { player: true });
    h.step();
    h.system.teardown(h.context);
    h.events.publish(INTENT_INTERACT, {});
    h.events.flushDeferred();
    h.system.update(DT, h.context);
    expect(h.world.getComponent(entity, ANIMATION)?.oneShot).toBeNull();
  });
});

describe('pose output feeds rendering (interface contract)', () => {
  it('renderFrame draws the pose-resolved sprite instead of the base sprite', () => {
    const h = harness();
    const platform = createHeadlessPlatform({ width: 320, height: 180 });
    const entity = addAnimated(h.world, 'hero', { motion: MOVING_EAST });
    addManifest(h.world, {
      hero: 'assets/hero.png',
      'hero.walk.e.0': 'assets/we0.png',
    });
    h.step();

    const poses = animationPoses(0, h.context);
    expect(poses.get(entity)).toBe('hero.walk.e.0');
    renderFrame(0, h.context, platform.render, poses);
    const sprites = platform.render.commands.filter((c) => c['op'] === 'drawSprite');
    expect(sprites).toHaveLength(1);
    expect(sprites[0]).toMatchObject({ assetRef: 'assets/we0.png' });

    // Without poses the same frame falls back to the base sprite.
    platform.render.reset();
    renderFrame(0, h.context, platform.render);
    const fallback = platform.render.commands.filter((c) => c['op'] === 'drawSprite');
    expect(fallback[0]).toMatchObject({ assetRef: 'assets/hero.png' });
  });
});

describe('reduced motion (docs/34 FR-A11Y-002)', () => {
  function enableReducedMotion(world: EntityStore): void {
    const entity = world.createEntity();
    world.addComponent(entity, ACCESSIBILITY_SETTINGS, {
      ...DEFAULT_ACCESSIBILITY_SETTINGS,
      reducedMotion: true,
    });
  }

  it('freezes clip time so sprites rest on their first frame', () => {
    const h = harness();
    enableReducedMotion(h.world);
    const entity = addAnimated(h.world, 'sprite.player', { motion: MOVING_EAST });
    h.step();
    h.step();
    h.step();
    const state = h.world.getComponent(entity, ANIMATION);
    expect(state?.clip).toBe(CLIP_WALK); // state transitions still land
    expect(state?.elapsed).toBe(0); // but time never advances
    expect(state?.prevElapsed).toBe(0);
  });

  it('does not play one-shots', () => {
    const h = harness();
    enableReducedMotion(h.world);
    const entity = addAnimated(h.world, 'sprite.player', { player: true });
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(h.world.getComponent(entity, ANIMATION)?.oneShot).toBeNull();
  });
});
