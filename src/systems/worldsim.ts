/**
 * World Simulation System — the deterministic ambient-event scheduler that
 * keeps the world alive while the player is idle (issue #28; spec:
 * docs/24-World-Simulation-and-Ambient-Events.md).
 *
 * Each fixed step the System counts down the interval slice it owns
 * (FR-ARCH-015); when it lapses it draws the next interval and an event
 * from the Core RNG service — the seedable source, so identical seeds
 * replay identical ambient life (NFR-ARCH-001) — and announces
 * `ambient.event` as a deferred event (FR-ARCH-012). Density tuning: the
 * scheduler prefers targets near the player (there is always something
 * nearby, never dead space), falling back to any marker, and to a free
 * position in the logical space when a region has no markers at all —
 * ambient life never simply stops (FR-ARCH-008).
 *
 * What ambient activity *means* — which machines animate, what moves in
 * the background — is presentation and content: consumers (rendering,
 * audio, NPC behavior) subscribe to `ambient.event`, and each targeted
 * event also requests the Animation System's generic one-shot channel
 * (`ambient.<kind>` clips) so packs can bind visible ambient art purely
 * through the asset manifest. The engine names no career fact.
 */
import type { Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { ANIMATION_ONE_SHOT } from './animation';
import { LOGICAL_SPACE, PLAYER_CONTROLLED, POSITION, RENDERABLE } from './scene';

/**
 * The scheduler slice, owned by this System (FR-ARCH-015): seconds until
 * the next ambient event. Plain serializable data, adopted across re-init
 * for hot-reload; -1 marks a fresh slice whose first interval has not been
 * drawn yet (drawing it in `update` keeps all RNG use inside simulation).
 */
export type WorldSimState = { readonly nextIn: number };
export const WORLD_SIM = defineComponentType<WorldSimState>('world-sim');

const UNSCHEDULED: WorldSimState = { nextIn: -1 };

/**
 * An ambient happening, announced for any System to interpret: a generic
 * kind, where it happens, and the marker entity it targets (null when the
 * region has no markers and the event is purely positional).
 */
export const AMBIENT_EVENT = defineEventType<{
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly targetId: number | null;
}>('ambient.event');

/**
 * The generic ambient vocabulary: `pulse` (machinery stirring), `drift`
 * (something passing through), `stir` (background activity). What each
 * looks and sounds like is content — packs bind `ambient.<kind>` clips
 * and cues; the engine ships only the rhythm.
 */
export const AMBIENT_KINDS: readonly string[] = ['pulse', 'drift', 'stir'];

/** One-shot clips requested for targeted events: `ambient.<kind>`. */
export const AMBIENT_CLIP_PREFIX = 'ambient';

/**
 * Density tuning (deliverable: no dead space): the next event lands
 * uniformly inside this window, so ambient life is steady but never
 * metronomic. Seconds of simulation time.
 */
export const AMBIENT_MIN_INTERVAL = 1.5;
export const AMBIENT_MAX_INTERVAL = 4;

/** Markers within this many logical units of the player are preferred. */
export const AMBIENT_NEARBY_RADIUS = 96;

/** Renderable kinds that can host ambient activity (generic scene roles). */
const AMBIENT_TARGET_KINDS: ReadonlySet<string> = new Set(['npc', 'building']);

/**
 * Build the World Simulation System. A factory so each booted world
 * composes a fresh instance; the slice entity is rediscovered on re-init
 * (hot-reload safe).
 */
export function createWorldSimSystem(): System {
  return {
    id: 'worldsim',
    dependencies: [],
    init(context: SystemContext): void {
      // The scheduler slice: adopt an existing entity (hot re-init) or
      // spawn one unscheduled. This System is its sole writer.
      if (context.world.query(WORLD_SIM)[0] === undefined) {
        context.world.addComponent(context.world.createEntity(), WORLD_SIM, UNSCHEDULED);
      }
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      const sliceEntity = world.query(WORLD_SIM)[0];
      if (sliceEntity === undefined) return;
      const state = world.getComponent(sliceEntity, WORLD_SIM) ?? UNSCHEDULED;

      const drawInterval = () =>
        AMBIENT_MIN_INTERVAL + context.rng.next() * (AMBIENT_MAX_INTERVAL - AMBIENT_MIN_INTERVAL);

      // A fresh slice draws its first interval here, not in init, so every
      // RNG draw happens inside deterministic simulation steps.
      let nextIn = state.nextIn < 0 ? drawInterval() : state.nextIn - dt;

      if (nextIn <= 0) {
        // The player's surroundings first (never dead space), any marker
        // second, a free position third — ascending entity order keeps
        // candidate lists reproducible (NFR-ARCH-001).
        const player = (() => {
          for (const entity of world.query(PLAYER_CONTROLLED, POSITION)) {
            const position = world.getComponent(entity, POSITION);
            if (position !== undefined) return position;
          }
          return null;
        })();
        const markers = world.query(RENDERABLE, POSITION).filter((entity) => {
          const renderable = world.getComponent(entity, RENDERABLE);
          return renderable !== undefined && AMBIENT_TARGET_KINDS.has(renderable.kind);
        });
        const nearby =
          player === null
            ? markers
            : markers.filter((entity) => {
                const position = world.getComponent(entity, POSITION);
                if (position === undefined) return false;
                const dx = position.x - player.x;
                const dy = position.y - player.y;
                return dx * dx + dy * dy <= AMBIENT_NEARBY_RADIUS * AMBIENT_NEARBY_RADIUS;
              });
        const candidates = nearby.length > 0 ? nearby : markers;

        const kind = AMBIENT_KINDS[context.rng.nextInt(AMBIENT_KINDS.length)] ?? 'pulse';
        if (candidates.length > 0) {
          const target = candidates[context.rng.nextInt(candidates.length)];
          const position = target === undefined ? undefined : world.getComponent(target, POSITION);
          if (target !== undefined && position !== undefined) {
            context.events.publish(AMBIENT_EVENT, {
              kind,
              x: position.x,
              y: position.y,
              targetId: target,
            });
            // Visible life with zero coupling: the Animation System's
            // generic one-shot channel plays `ambient.<kind>` on the
            // marker when the pack's manifest defines frames for it.
            context.events.publish(ANIMATION_ONE_SHOT, {
              clip: `${AMBIENT_CLIP_PREFIX}.${kind}`,
              entityId: target,
            });
          }
        } else {
          // No markers at all: ambient life continues as positional
          // events somewhere in the space (FR-ARCH-008).
          context.events.publish(AMBIENT_EVENT, {
            kind,
            x: context.rng.next() * LOGICAL_SPACE.width,
            y: context.rng.next() * LOGICAL_SPACE.height,
            targetId: null,
          });
        }
        nextIn = drawInterval();
      }

      if (nextIn !== state.nextIn) {
        world.addComponent(sliceEntity, WORLD_SIM, { nextIn });
      }
    },
    teardown(): void {},
  };
}

/**
 * The world-simulation plugin: the System plus the component and event
 * types it introduces, registered and removed as one unit (FR-ARCH-018).
 * A factory so every world composes a fresh System instance.
 */
export function createWorldSimPlugin(): Plugin {
  return {
    id: 'plugin.worldsim',
    systems: [createWorldSimSystem()],
    componentTypes: [WORLD_SIM],
    eventTypes: [AMBIENT_EVENT],
  };
}
