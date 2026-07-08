/**
 * App — the composition root that wires platform, core, systems, and
 * content into a running world. Host-agnostic: the same boot drives the
 * browser adapter and the headless adapter (NFR-ARCH-002/004).
 */
export { bootWorld } from './boot';
export type { BootWorldOptions, WorldHandle } from './boot';
export { buildDebugSnapshot, formatDebugOverlay } from './debug';
export type { DebugEventEntry, DebugSnapshot } from './debug';
export { packFilesFromBundle } from './pack-bundle';
export { pointerToLogical, present, surfaceTransform } from './present';
export type { SurfaceTransform } from './present';
export { spawnWorld } from './spawn';
export type { SpawnedWorld } from './spawn';
