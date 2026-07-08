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
}

/** Number of trailing event-log entries the overlay shows. */
const EVENT_TAIL = 8;

export function buildDebugSnapshot(
  loop: RuntimeLoop,
  registry: ModuleRegistry,
  events: EventBus,
): DebugSnapshot {
  const time = loop.context.time;
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
  };
}

/** Render the snapshot as the overlay's monospace text block. */
export function formatDebugOverlay(snapshot: DebugSnapshot): string {
  const lines = [
    `frame ${snapshot.frame}  step ${snapshot.step}  sim ${snapshot.simSeconds.toFixed(2)}s` +
      (snapshot.paused ? '  [paused]' : ''),
    `faults ${snapshot.faultCount}`,
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
