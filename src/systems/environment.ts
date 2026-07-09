/**
 * Environment System — the deterministic world clock and weather driver
 * (issue #29; spec: docs/23-Day-Night-and-Weather.md).
 *
 * Owns one ENVIRONMENT slice (FR-ARCH-015): seconds into the day/night
 * cycle, the current phase, the current weather state, and the countdown
 * to the next weather draw. Each fixed step the clock advances by `dt`;
 * phase transitions publish the shared `time.phase-changed` event
 * (deferred, FR-ARCH-012) that audio beds and NPC routines already
 * consume, and write the render layer's ENVIRONMENT_LIGHT tint hook so
 * night is *visible* (a translucent overlay) without rendering knowing
 * this System exists.
 *
 * Weather follows the region's content ambient profile: the region
 * document's `ambient.weatherProfile` names a profile whose states this
 * System cycles through on intervals drawn from the Core RNG service —
 * seeded, so identical seeds replay identical skies (NFR-ARCH-001). A
 * region that opts out of `dayNight` keeps a steady day; an unknown
 * profile degrades to a steady default state (FR-ARCH-008). The engine
 * names no career fact: profiles and phases are generic vocabulary, and
 * what any of it looks like belongs to content and presentation.
 */
import type { EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { TIME_PHASE_CHANGED } from './audio';
import { ENVIRONMENT_LIGHT } from './render';

/**
 * The region's ambient profile as spawned from its content document
 * (`ambient` block): which weather profile applies and whether the
 * day/night cycle runs. Data only.
 */
export type RegionAmbient = {
  readonly weatherProfile: string;
  readonly dayNight: boolean;
};
export const REGION_AMBIENT = defineComponentType<RegionAmbient>('region-ambient');

/**
 * The environment slice, owned by this System (FR-ARCH-015): clock
 * progress, derived phase, current weather, and the countdown to the next
 * weather draw (-1 marks a fresh slice whose first interval has not been
 * drawn — drawing it in `update` keeps all RNG use inside simulation).
 */
export type EnvironmentState = {
  readonly elapsed: number;
  readonly phase: string;
  readonly weather: string;
  readonly weatherIn: number;
};
export const ENVIRONMENT = defineComponentType<EnvironmentState>('environment');

/** The weather state changed; consumers (rendering, audio) interpret it. */
export const WEATHER_CHANGED = defineEventType<{ readonly weather: string }>('weather.changed');

/** The engine's phase vocabulary — the same strings NPC routines target. */
export const PHASE_DAY = 'day';
export const PHASE_NIGHT = 'night';

/** Cycle tuning (seconds of simulation time); budgets may retune. */
export const DAY_SECONDS = 60;
export const NIGHT_SECONDS = 60;

/** The night lighting hook written to ENVIRONMENT_LIGHT; day is null. */
export const NIGHT_TINT = 'rgba(10, 14, 34, 0.35)';

/** Weather redraw window (seconds), drawn uniformly per change. */
export const WEATHER_MIN_SECONDS = 45;
export const WEATHER_MAX_SECONDS = 90;

/**
 * Weather states per profile — generic engine vocabulary a region's
 * content `weatherProfile` selects (DATA-FR-027: the profile is content,
 * the meaning of each state is presentation). Unknown profiles degrade to
 * the default steady state.
 */
export const WEATHER_PROFILES: ReadonlyMap<string, readonly string[]> = new Map([
  ['temperate', ['clear', 'overcast', 'rain']],
]);
export const DEFAULT_WEATHER_STATES: readonly string[] = ['clear'];

const INITIAL_STATE: EnvironmentState = {
  elapsed: 0,
  phase: PHASE_DAY,
  weather: '',
  weatherIn: -1,
};

/** The active region ambient profile; null when no region declares one. */
function ambientOf(world: EntityStore): RegionAmbient | null {
  for (const entity of world.query(REGION_AMBIENT)) {
    const ambient = world.getComponent(entity, REGION_AMBIENT);
    if (ambient !== undefined) return ambient;
  }
  return null;
}

/**
 * Build the Environment System. A factory so each booted world composes a
 * fresh instance; the slice entity is rediscovered on re-init.
 */
export function createEnvironmentSystem(): System {
  return {
    id: 'environment',
    dependencies: [],
    init(context: SystemContext): void {
      // The environment slice: adopt an existing entity (hot re-init) or
      // spawn one at the cycle start. This System is its sole writer; the
      // same entity carries the lighting hook rendering reads.
      if (context.world.query(ENVIRONMENT)[0] === undefined) {
        const entity = context.world.createEntity();
        context.world.addComponent(entity, ENVIRONMENT, INITIAL_STATE);
        context.world.addComponent(entity, ENVIRONMENT_LIGHT, { tint: null });
      }
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      const sliceEntity = world.query(ENVIRONMENT)[0];
      if (sliceEntity === undefined) return;
      const state = world.getComponent(sliceEntity, ENVIRONMENT) ?? INITIAL_STATE;
      const ambient = ambientOf(world);
      const states = WEATHER_PROFILES.get(ambient?.weatherProfile ?? '') ?? DEFAULT_WEATHER_STATES;

      // The clock: a region opts into the cycle through its content
      // ambient block; without it the world holds a steady day.
      let elapsed = state.elapsed;
      let phase: string;
      if (ambient?.dayNight === true) {
        elapsed = (elapsed + dt) % (DAY_SECONDS + NIGHT_SECONDS);
        phase = elapsed < DAY_SECONDS ? PHASE_DAY : PHASE_NIGHT;
      } else {
        phase = PHASE_DAY;
      }
      if (phase !== state.phase) {
        context.events.publish(TIME_PHASE_CHANGED, { phase });
      }

      // The lighting hook: rendering overlays the tint when non-null; a
      // world without a renderer simply carries the value (FR-ARCH-008).
      const tint = phase === PHASE_NIGHT ? NIGHT_TINT : null;
      if ((world.getComponent(sliceEntity, ENVIRONMENT_LIGHT)?.tint ?? null) !== tint) {
        world.addComponent(sliceEntity, ENVIRONMENT_LIGHT, { tint });
      }

      // Weather: hold a valid state for the active profile, and redraw on
      // seeded intervals — same seed, same skies (NFR-ARCH-001).
      let weather = states.includes(state.weather) ? state.weather : (states[0] ?? 'clear');
      let weatherIn = state.weatherIn;
      if (weatherIn < 0) {
        weatherIn =
          WEATHER_MIN_SECONDS + context.rng.next() * (WEATHER_MAX_SECONDS - WEATHER_MIN_SECONDS);
      } else {
        weatherIn -= dt;
        if (weatherIn <= 0) {
          const others = states.filter((candidate) => candidate !== weather);
          const next =
            others.length > 0 ? (others[context.rng.nextInt(others.length)] ?? weather) : weather;
          if (next !== weather) {
            weather = next;
            context.events.publish(WEATHER_CHANGED, { weather });
          }
          weatherIn =
            WEATHER_MIN_SECONDS + context.rng.next() * (WEATHER_MAX_SECONDS - WEATHER_MIN_SECONDS);
        }
      }

      if (
        elapsed !== state.elapsed ||
        phase !== state.phase ||
        weather !== state.weather ||
        weatherIn !== state.weatherIn
      ) {
        world.addComponent(sliceEntity, ENVIRONMENT, { elapsed, phase, weather, weatherIn });
      }
    },
    teardown(): void {},
  };
}

/**
 * The environment plugin: the System plus the component and event types
 * it introduces, registered and removed as one unit (FR-ARCH-018). A
 * factory so every world composes a fresh System instance.
 */
export function createEnvironmentPlugin(): Plugin {
  return {
    id: 'plugin.environment',
    systems: [createEnvironmentSystem()],
    componentTypes: [ENVIRONMENT, REGION_AMBIENT],
    eventTypes: [WEATHER_CHANGED],
  };
}
