/**
 * Boot the engine end to end (issue #15): load and validate the content
 * pack, register the slice's plugins, spawn the start region and player,
 * and wire the deterministic runtime loop to the platform adapter. This is
 * the composition root — the one place the layers meet; it is host-agnostic
 * and runs identically on the browser and headless adapters (NFR-ARCH-004).
 */
import type { SystemContext } from '../core';
import { EntityStore, EventBus, ModuleRegistry, RuntimeLoop } from '../core';
import type { PackFiles, ResolvedContentGraph } from '../content';
import { loadPack } from '../content';
import type { Platform } from '../platform';
import {
  animationPoses,
  createAccessibilityPlugin,
  createAchievementsPlugin,
  createAnalyticsPlugin,
  createAnimationPlugin,
  createAssemblyPlugin,
  createAudioPlugin,
  createBuildingPlugin,
  createCameraPlugin,
  createDialoguePlugin,
  createEnvironmentPlugin,
  createMinigameHostPlugin,
  createNpcPlugin,
  createOnboardingPlugin,
  createOrchestratePlugin,
  createProgressionPlugin,
  createQuestPlugin,
  createRouteAndBalancePlugin,
  createSaveLoadPlugin,
  createInputPlugin,
  createLocalePlugin,
  createUiPlugin,
  createWorldSimPlugin,
  loadWorld,
  uiFrame,
  movementPlugin,
  physicsPlugin,
  pointerToLogical,
  renderFrame,
  renderPlugin,
  scenePlugin,
  REGION_ENTERED,
  WORLD_RESTORED,
  SAVE_SLOT_KEY,
} from '../systems';
import type { DebugSnapshot } from './debug';
import { buildDebugSnapshot, formatDebugOverlay } from './debug';
import { createFaultReporter } from './faults';
import { createFrameProfiler } from './perf';
import type { SpawnedWorld } from './spawn';
import { spawnWorld } from './spawn';

/** Simulation rate for the slice: 60 fixed steps per second (FR-ARCH-021). */
const FIXED_DT = 1 / 60;

export interface BootWorldOptions {
  readonly platform: Platform;
  readonly packFiles: PackFiles;
  /** RNG seed (NFR-ARCH-001); a fixed value replays identically. */
  readonly seed: number;
  /** Receives the formatted debug overlay text once per presented frame. */
  readonly onOverlayText?: (text: string) => void;
  /**
   * Receives centralized fault-report lines (issue #42, FR-OBS-001..003):
   * each isolated System fault formatted with context and rate-limited.
   * The host decides where lines go; omitted means no report sink, with
   * behavior otherwise identical.
   */
  readonly onFaultLine?: (line: string) => void;
  /**
   * Safe resume: after spawning, overlay the progression save from the
   * platform storage when one exists and matches this pack (issue #24).
   * Off by default so tests and replays always start from a clean spawn.
   */
  readonly resume?: boolean;
}

export interface WorldHandle {
  readonly loop: RuntimeLoop;
  readonly registry: ModuleRegistry;
  readonly events: EventBus;
  readonly world: EntityStore;
  readonly graph: ResolvedContentGraph;
  readonly spawned: SpawnedWorld;
  /** Live debug data for the overlay (FR-ARCH-031). */
  debugSnapshot(): DebugSnapshot;
  /** Subscribe the loop to the platform's frame ticker; returns stop. */
  start(): () => void;
}

/**
 * Load the pack (rejecting invalid content atomically, FR-ARCH-030), build
 * the world, and return a handle ready to `start()` — or to drive frame by
 * frame in tests and replays (NFR-ARCH-002).
 */
export function bootWorld(options: BootWorldOptions): WorldHandle {
  const { platform, packFiles, seed } = options;
  const graph = loadPack(packFiles);

  const registry = new ModuleRegistry();
  registry.register(scenePlugin);
  // Before input (issue #37): a rebind applied this step is read by the
  // Input System the same step, so remaps land without a frame of lag.
  registry.register(createAccessibilityPlugin());
  // The locale service (issue #38): resolves the strings table every
  // player-visible surface reads, before UI consumes it this step.
  registry.register(createLocalePlugin());
  registry.register(createInputPlugin());
  registry.register(movementPlugin);
  // Registered between Movement and Physics so the stable tiebreak keeps
  // character motion inside the same step's constraint sweep.
  registry.register(createNpcPlugin());
  registry.register(physicsPlugin);
  // After physics: the Buildings System consumes the doorway occupancy the
  // constraint pass settled this step (issue #30).
  registry.register(createBuildingPlugin());
  registry.register(createWorldSimPlugin());
  registry.register(createEnvironmentPlugin());
  registry.register(createQuestPlugin());
  // The mini-games host (issue #33): serves the launch API and forwards
  // mechanic resolutions into the quest engine's result feed. Mechanic
  // plugins from the catalog (#34) register after it.
  registry.register(createMinigameHostPlugin());
  registry.register(createRouteAndBalancePlugin());
  registry.register(createAssemblyPlugin());
  registry.register(createOrchestratePlugin());
  // After quest: progression records the resolutions the quest engine
  // announced this step (issue #31).
  registry.register(createProgressionPlugin());
  // After progression: achievements evaluate against the record it just
  // settled (issue #32).
  registry.register(createAchievementsPlugin());
  registry.register(createDialoguePlugin());
  registry.register(createAnimationPlugin());
  registry.register(createCameraPlugin());
  const saveLoadOptions = { pack: { id: graph.packId, version: graph.packVersion } };
  registry.register(renderPlugin);
  registry.register(createUiPlugin());
  // After UI (issue #44): diegetic first-session guidance reads the UI
  // slice the UI System settled this step and rides its hint line.
  registry.register(createOnboardingPlugin());
  registry.register(createAudioPlugin());
  // Passive funnel telemetry (issue #39): a bus subscriber translating
  // gameplay events into anonymized metrics; never on the gameplay path.
  registry.register(createAnalyticsPlugin());
  registry.register(createSaveLoadPlugin(saveLoadOptions));

  const world = new EntityStore();
  const events = new EventBus({ logEnabled: true });
  const spawned = spawnWorld(world, graph);
  events.publish(REGION_ENTERED, { regionId: spawned.regionId });

  // Profiling (issue #40, FR-PERF-006): rolling aggregates over the step
  // costs the loop's probe already measures. Observability only — recorded
  // at presentation, never read by simulation (FR-PERF-007).
  const profiler = createFrameProfiler();
  let profiledStep = -1;

  // Centralized fault reporting (issue #42): the loop isolates, the
  // reporter formats and throttles, the host's sink receives (FR-OBS-003).
  const faultReporter =
    options.onFaultLine === undefined ? null : createFaultReporter(options.onFaultLine);

  const loop = new RuntimeLoop(
    registry,
    {
      world,
      events,
      // Slice scheduler: run scheduled work immediately and synchronously,
      // which is trivially deterministic; async offload arrives with the
      // systems that need it (FR-ARCH-028).
      scheduler: { schedule: (task) => task() },
      platform,
    },
    {
      fixedDt: FIXED_DT,
      seed,
      // Sample the host input once per frame and normalize the pointer into
      // logical units at the boundary, so the simulation never sees pixels
      // and every System observes identical input (FR-ARCH-023).
      sampleInput: () => {
        const snapshot = platform.input.snapshot();
        const pointer = pointerToLogical(
          snapshot.pointer.x,
          snapshot.pointer.y,
          platform.render.size(),
        );
        return {
          keys: snapshot.keys,
          pointer: { x: pointer.x, y: pointer.y, buttons: snapshot.pointer.buttons },
        };
      },
      // Presentation order per docs/02: animation interpolates its pose,
      // rendering draws the world, then UI draws above it.
      onPresent: (alpha: number, context: SystemContext) => {
        renderFrame(alpha, context, platform.render, animationPoses(alpha, context));
        uiFrame(context, platform.render);
        // Record the latest step's total System cost once per step; frames
        // that ran no step would only repeat stale timings.
        if (context.time.step !== profiledStep) {
          profiledStep = context.time.step;
          let stepMs = 0;
          for (const timing of loop.lastFrameTimings) stepMs += timing.milliseconds;
          profiler.record(stepMs);
        }
        options.onOverlayText?.(
          formatDebugOverlay(buildDebugSnapshot(loop, registry, events, profiler.summary())),
        );
      },
      monotonicNowMs: () => platform.timers.monotonicNowMs(),
      ...(faultReporter === null ? {} : { onFault: (fault) => faultReporter.handle(fault) }),
    },
  );

  let resumed = false;
  return {
    loop,
    registry,
    events,
    world,
    graph,
    spawned,
    debugSnapshot: () => buildDebugSnapshot(loop, registry, events, profiler.summary()),
    start: () => {
      const stop = loop.run((onFrame) => platform.timers.frameTicker(onFrame));
      // Safe resume (issue #24): overlay the stored progression save after
      // Systems have initialized their owned slices, so saved values land
      // on the same deterministic entity ids. A missing, foreign, or
      // corrupt save leaves the fresh spawn untouched.
      if (options.resume === true && !resumed) {
        resumed = true;
        if (loadWorld(loop.context, saveLoadOptions)) {
          events.publish(WORLD_RESTORED, { slot: SAVE_SLOT_KEY });
        }
      }
      return stop;
    },
  };
}
