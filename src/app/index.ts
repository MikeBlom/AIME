/**
 * App — the composition root that wires platform, core, systems, and
 * content into a running world. Host-agnostic: the same boot drives the
 * browser adapter and the headless adapter (NFR-ARCH-002/004).
 */
export { bootWorld } from './boot';
export type { BootWorldOptions, WorldHandle } from './boot';
export { buildDebugSnapshot, formatDebugOverlay } from './debug';
export type { DebugEventEntry, DebugSnapshot } from './debug';
export {
  createFaultReporter,
  faultMessage,
  formatFault,
  FULL_REPORTS_PER_SYSTEM,
  SUMMARY_EVERY,
} from './faults';
export type { FaultReporter } from './faults';
export { packFilesFromBundle } from './pack-bundle';
export {
  checkCiBudgets,
  createFrameProfiler,
  formatViolations,
  PERF_BUDGETS,
  PROFILE_WINDOW,
} from './perf';
export type { BudgetViolation, CiPerfMeasurements, FrameProfile, FrameProfiler } from './perf';
export { spawnWorld } from './spawn';
export type { SpawnedWorld } from './spawn';
