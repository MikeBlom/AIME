/**
 * Performance budgets and profiling (issue #40; spec:
 * docs/33-Performance-Budgets.md).
 *
 * Three small, pure pieces:
 *
 * 1. PERF_BUDGETS — the documented budgets as data, the single source other
 *    issues must not regress (the interface contract). Numbers change by
 *    updating docs/33 and this table together, never by drift.
 * 2. createFrameProfiler — rolling aggregate statistics (average and worst
 *    over a recent window) for the simulation-step costs the runtime loop
 *    already measures (FR-ARCH-031). Pure aggregation of injected-probe
 *    values: no clock in here, observability only (FR-PERF-007).
 * 3. checkCiBudgets — the regression detector (FR-PERF-010): measurements
 *    in, named violations out, so a CI failure reads as "which budget, by
 *    how much" rather than a bare assertion (NFR-PERF-003).
 */

/**
 * The budgets from docs/33, in milliseconds. Device budgets describe the
 * `laptop` and `phone` profiles; `ci` carries the enforcement thresholds
 * the perf smoke run holds — deliberately looser than device budgets so
 * runner variance never masquerades as a regression (FR-PERF-009).
 */
export const PERF_BUDGETS = {
  /** Full frame — simulation plus presentation (FR-PERF-001). */
  frameMs: { laptop: 16.7, phone: 33.3 },
  /** One fixed simulation step, all Systems (FR-PERF-002). */
  stepMs: { laptop: 8, phone: 16 },
  /** Single-System guidance on the laptop profile (FR-PERF-003). */
  systemStepMs: 2,
  /** Pack load and validation (FR-PERF-004). */
  packLoadMs: 500,
  /** Pack load through the first presented frame (FR-PERF-005). */
  bootMs: { laptop: 1000, phone: 2000 },
  /** CI smoke enforcement thresholds (FR-PERF-008/009). */
  ci: { bootMs: 1500, avgStepMs: 8, maxStepMs: 50 },
} as const;

/** Rolling window length: ~2 seconds of steps at the 60 Hz fixed rate. */
export const PROFILE_WINDOW = 120;

/** Aggregate simulation-cost statistics over the recent window. */
export interface FrameProfile {
  /** Window capacity, in recorded steps. */
  readonly windowSize: number;
  /** Steps currently aggregated (≤ window). */
  readonly frames: number;
  readonly avgMs: number;
  readonly worstMs: number;
}

export interface FrameProfiler {
  /** Record one fixed step's total simulation cost, in milliseconds. */
  record(stepMs: number): void;
  summary(): FrameProfile;
}

/**
 * Build a rolling profiler. Pure aggregation over recorded values — the
 * caller feeds it the loop's probe-measured step costs; without a probe
 * those are zeros and the profile reads zero (FR-PERF-007).
 */
export function createFrameProfiler(windowSize: number = PROFILE_WINDOW): FrameProfiler {
  const samples: number[] = [];
  return {
    record: (stepMs) => {
      if (!Number.isFinite(stepMs) || stepMs < 0) return;
      samples.push(stepMs);
      if (samples.length > windowSize) samples.splice(0, samples.length - windowSize);
    },
    summary: () => {
      if (samples.length === 0) return { windowSize, frames: 0, avgMs: 0, worstMs: 0 };
      let total = 0;
      let worst = 0;
      for (const sample of samples) {
        total += sample;
        if (sample > worst) worst = sample;
      }
      return { windowSize, frames: samples.length, avgMs: total / samples.length, worstMs: worst };
    },
  };
}

/** One exceeded budget: which, measured, and the limit (NFR-PERF-003). */
export interface BudgetViolation {
  readonly budget: string;
  readonly measuredMs: number;
  readonly limitMs: number;
}

/** What the CI smoke run measures (FR-PERF-008). */
export interface CiPerfMeasurements {
  /** Pack load through the first presented frame. */
  readonly bootMs: number;
  /** Average per-step cost across the driven sequence. */
  readonly avgStepMs: number;
  /** Worst single-step cost across the driven sequence. */
  readonly maxStepMs: number;
}

/**
 * The regression detector (FR-PERF-010): compare measurements against the
 * CI thresholds and return every exceeded budget. Empty means green.
 */
export function checkCiBudgets(
  measurements: CiPerfMeasurements,
  thresholds: typeof PERF_BUDGETS.ci = PERF_BUDGETS.ci,
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  const hold = (budget: string, measuredMs: number, limitMs: number) => {
    if (measuredMs > limitMs) violations.push({ budget, measuredMs, limitMs });
  };
  hold('ci.bootMs', measurements.bootMs, thresholds.bootMs);
  hold('ci.avgStepMs', measurements.avgStepMs, thresholds.avgStepMs);
  hold('ci.maxStepMs', measurements.maxStepMs, thresholds.maxStepMs);
  return violations;
}

/** Render violations as one actionable line each (NFR-PERF-003). */
export function formatViolations(violations: readonly BudgetViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.budget}: measured ${violation.measuredMs.toFixed(2)}ms ` +
        `exceeds budget ${violation.limitMs.toFixed(2)}ms`,
    )
    .join('\n');
}
