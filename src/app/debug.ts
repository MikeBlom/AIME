/**
 * Debug overlay data (FR-ARCH-031, issue #15's overlay deliverable): a
 * plain-data snapshot of the live event log, active Systems, and frame
 * timing, plus a text formatter. Building the snapshot only reads engine
 * state — enabling or disabling the overlay never changes behavior.
 *
 * The overlay is developer diagnostics, not player-visible world text, so
 * its labels are technical identifiers rather than locale keys.
 */
import type { EventBus, ModuleRegistry, RuntimeLoop, SystemTiming } from '../core';
import { faultMessage } from './faults';
import type { FrameProfile } from './perf';
import { PERF_BUDGETS } from './perf';

export interface DebugEventEntry {
  readonly seq: number;
  readonly kind: string;
  readonly type: string;
  readonly delivery: string;
}

export interface DebugSnapshot {
  readonly frame: number;
  readonly step: number;
  readonly simSeconds: number;
  readonly paused: boolean;
  readonly faultCount: number;
  readonly systems: readonly string[];
  readonly timings: readonly SystemTiming[];
  readonly events: readonly DebugEventEntry[];
  /** Rolling step-cost profile vs. budgets (FR-PERF-006); null when absent. */
  readonly profile: FrameProfile | null;
  /** The most recent isolated fault's context (FR-OBS-004); null when clean. */
  readonly lastFault: {
    readonly systemId: string;
    readonly step: number;
    readonly frame: number;
    readonly message: string;
  } | null;
}

/** Number of trailing event-log entries the overlay shows. */
const EVENT_TAIL = 8;

export function buildDebugSnapshot(
  loop: RuntimeLoop,
  registry: ModuleRegistry,
  events: EventBus,
  profile: FrameProfile | null = null,
): DebugSnapshot {
  const time = loop.context.time;
  const fault = loop.faults.at(-1);
  return {
    frame: time.frame,
    step: time.step,
    simSeconds: time.now,
    paused: loop.paused,
    faultCount: loop.faults.length,
    systems: registry.order.map((system) => system.id),
    timings: loop.lastFrameTimings,
    events: events.eventLog.slice(-EVENT_TAIL).map((entry) => ({
      seq: entry.seq,
      kind: entry.kind,
      type: entry.type,
      delivery: entry.delivery,
    })),
    profile,
    lastFault:
      fault === undefined
        ? null
        : {
            systemId: fault.systemId,
            step: fault.step,
            frame: fault.frame,
            message: faultMessage(fault.error),
          },
  };
}

/** Render the snapshot as the overlay's monospace text block. */
export function formatDebugOverlay(snapshot: DebugSnapshot): string {
  const budgetMs = PERF_BUDGETS.stepMs.laptop;
  const profileLine =
    snapshot.profile === null || snapshot.profile.frames === 0
      ? []
      : [
          `profile: step avg ${snapshot.profile.avgMs.toFixed(3)}ms  ` +
            `worst ${snapshot.profile.worstMs.toFixed(3)}ms  ` +
            `budget ${budgetMs.toFixed(1)}ms (last ${snapshot.profile.frames})` +
            (snapshot.profile.avgMs > budgetMs ? '  [over budget]' : ''),
        ];
  const lines = [
    `frame ${snapshot.frame}  step ${snapshot.step}  sim ${snapshot.simSeconds.toFixed(2)}s` +
      (snapshot.paused ? '  [paused]' : ''),
    `faults ${snapshot.faultCount}` +
      (snapshot.lastFault === null
        ? ''
        : `  last ${snapshot.lastFault.systemId}@${snapshot.lastFault.step}: ${snapshot.lastFault.message}`),
    ...profileLine,
    'systems:',
    ...snapshot.systems.map((id) => {
      const timing = snapshot.timings.find((t) => t.systemId === id);
      return `  ${id}  ${(timing?.milliseconds ?? 0).toFixed(3)}ms`;
    }),
    'events:',
    ...snapshot.events.map(
      (entry) => `  #${entry.seq} ${entry.kind} ${entry.type} (${entry.delivery})`,
    ),
  ];
  return lines.join('\n');
}
