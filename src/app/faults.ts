/**
 * Fault reporting (issue #42; spec: docs/43-Observability-and-Error-Handling.md).
 *
 * The centralized error reporting the interface contract names: the loop
 * already isolates a System failure and records it with context
 * (FR-ARCH-029); this reporter turns each isolated fault into one
 * actionable line — system, step, frame, error — and rate-limits repeats
 * so a crash-looping System yields signal, not a line per step
 * (FR-OBS-001/002).
 *
 * Host-agnostic by construction (FR-OBS-003): formatting and throttling
 * live here; the composition root injects where lines go (the browser
 * entry passes the console, tests pass a capture, headless runs may pass
 * nothing at all). Memory is per-System counters only (FR-OBS-007), and
 * the reporter never feeds anything back into simulation (FR-OBS-006).
 */
import type { SystemFault } from '../core';

/** Faults per System reported in full before summarizing (FR-OBS-002). */
export const FULL_REPORTS_PER_SYSTEM = 3;

/** After that, one summary line per this many repeats (FR-OBS-002). */
export const SUMMARY_EVERY = 100;

/** The floor for whatever a System threw: Error message or String(). */
export function faultMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One fault as one greppable line (NFR-OBS-003). */
export function formatFault(fault: SystemFault): string {
  return (
    `fault: system=${fault.systemId} step=${fault.step} frame=${fault.frame} ` +
    `error=${faultMessage(fault.error)}`
  );
}

export interface FaultReporter {
  /** Feed one isolated fault from the loop's onFault hook. */
  handle(fault: SystemFault): void;
}

/**
 * Build the reporter around an emit callback. The first few faults per
 * System report in full; afterwards every SUMMARY_EVERY-th repeat emits a
 * summary carrying the running total, so the report sink stays legible
 * under a fault storm while the loop's bounded fault log keeps the full
 * entries for inspection.
 */
export function createFaultReporter(emit: (line: string) => void): FaultReporter {
  const counts = new Map<string, number>();
  return {
    handle: (fault) => {
      const count = (counts.get(fault.systemId) ?? 0) + 1;
      counts.set(fault.systemId, count);
      if (count <= FULL_REPORTS_PER_SYSTEM) {
        emit(formatFault(fault));
      } else if ((count - FULL_REPORTS_PER_SYSTEM) % SUMMARY_EVERY === 0) {
        emit(
          `fault: system=${fault.systemId} repeating — ${count} total, ` +
            `latest step=${fault.step} error=${faultMessage(fault.error)}`,
        );
      }
    },
  };
}
