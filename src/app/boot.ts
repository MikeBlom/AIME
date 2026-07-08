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
  createAnimationPlugin,
  createAudioPlugin,
  createCameraPlugin,
  createUiPlugin,
  inputPlugin,
  uiFrame,
  movementPlugin,
  pointerToLogical,
  renderFrame,
  renderPlugin,
  scenePlugin,
  REGION_ENTERED,
} from '../systems';
import type { DebugSnapshot } from './debug';
import { buildDebugSnapshot, formatDebugOverlay } from './debug';
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
  registry.register(inputPlugin);
  registry.register(movementPlugin);
  registry.register(createAnimationPlugin());
  registry.register(createCameraPlugin());
  registry.register(renderPlugin);
  registry.register(createUiPlugin());
  registry.register(createAudioPlugin());

  const world = new EntityStore();
  const events = new EventBus({ logEnabled: true });
  const spawned = spawnWorld(world, graph);
  events.publish(REGION_ENTERED, { regionId: spawned.regionId });

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
        options.onOverlayText?.(formatDebugOverlay(buildDebugSnapshot(loop, registry, events)));
      },
      monotonicNowMs: () => platform.timers.monotonicNowMs(),
    },
  );

  return {
    loop,
    registry,
    events,
    world,
    graph,
    spawned,
    debugSnapshot: () => buildDebugSnapshot(loop, registry, events),
    start: () => loop.run((onFrame) => platform.timers.frameTicker(onFrame)),
  };
}
