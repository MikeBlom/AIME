/**
 * Analytics System — privacy-first funnel telemetry derived from the event
 * bus (issue #39; spec: docs/36-Analytics-and-Telemetry.md).
 *
 * A passive subscriber (the interface contract): it listens to gameplay
 * events already on the bus and translates the first occurrence of each
 * funnel milestone into one anonymized metric — the milestone's name and
 * the simulation time it landed. Event payloads are never forwarded; the
 * metric vocabulary is engine-generic (no career fact, no player data), so
 * personal data cannot leak by construction (FR-A11Y-style guarantee at
 * the type level: the sink accepts name + number only).
 *
 * The System owns the ANALYTICS_STATE slice (FR-ARCH-015): the enabled
 * flag (writable only via `analytics.control` events) and the milestones
 * already captured, which persists through save/load so a resumed session
 * never double-counts its funnel. Disabled telemetry drops events on the
 * floor; a platform without a sink degrades to silence — gameplay is
 * never blocked either way (FR-ARCH-008). Determinism (NFR-ARCH-001):
 * milestones are stamped with TimeService simulation time, never a wall
 * clock, so replays record identical metrics.
 */
import type { EntityId, EventPayload, EventType, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import type { TelemetrySink } from '../platform';
import { INTENT_INTERACT } from './input';
import { REGION_ONLINE, REGION_STATE_CHANGED, SYSTEM_RESTORED } from './quest';

/**
 * The analytics slice, owned by this System (FR-ARCH-015): whether capture
 * is on, and each funnel milestone's first-occurrence simulation time.
 */
export type AnalyticsState = {
  readonly enabled: boolean;
  readonly milestones: { readonly [milestone: string]: number };
};
export const ANALYTICS_STATE = defineComponentType<AnalyticsState>('analytics-state');

export const DEFAULT_ANALYTICS_STATE: AnalyticsState = { enabled: true, milestones: {} };

/**
 * Request an analytics change (the disable switch AC2 requires). Any
 * System — or a future settings row — publishes it; only this System
 * writes the slice.
 */
export const ANALYTICS_CONTROL = defineEventType<{ readonly enabled?: boolean }>(
  'analytics.control',
);

/** The minimal funnel (issue #39): engine-generic milestone names. */
export const MILESTONE_FIRST_DELIGHT = 'first-delight';
export const MILESTONE_FIRST_RESTORATION = 'first-restoration';
export const MILESTONE_SHORT_VISIT = 'short-visit-complete';

/** Prefix for every funnel metric handed to the platform sink. */
export const FUNNEL_METRIC_PREFIX = 'funnel.';

/**
 * Milestone ← event bindings. The guard sees the payload only to decide
 * whether the milestone fired; nothing from the payload ever reaches the
 * sink. First delight is the first acknowledged interaction (FR-VIS-003's
 * feedback bundle answering the player); first restoration is the
 * restoration beat; the short visit completes when a region comes online
 * (the arc FR-VIS-008 wants a few minutes to deliver).
 */
const FUNNEL_BINDINGS: readonly {
  readonly milestone: string;
  readonly type: EventType<EventPayload>;
  readonly matches?: (payload: EventPayload) => boolean;
}[] = [
  { milestone: MILESTONE_FIRST_DELIGHT, type: INTENT_INTERACT },
  { milestone: MILESTONE_FIRST_RESTORATION, type: SYSTEM_RESTORED },
  {
    milestone: MILESTONE_SHORT_VISIT,
    type: REGION_STATE_CHANGED,
    matches: (payload) =>
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      (payload as { readonly [key: string]: EventPayload })['state'] === REGION_ONLINE,
  },
];

/** Narrow the open platform record to a TelemetrySink; null is silence. */
function telemetryOf(platform: SystemContext['platform']): TelemetrySink | null {
  const candidate = (platform as { readonly telemetry?: unknown }).telemetry;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as TelemetrySink).record === 'function'
  ) {
    return candidate as TelemetrySink;
  }
  return null;
}

/** Defensive control merge: unknown/invalid fields are ignored. */
function mergeControl(state: AnalyticsState, payload: EventPayload): AnalyticsState {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return state;
  const enabled = (payload as { readonly [key: string]: EventPayload })['enabled'];
  return typeof enabled === 'boolean' ? { ...state, enabled } : state;
}

/**
 * Build the Analytics System. A factory (not a shared instance) because
 * the System buffers milestone hits and control events between flush and
 * update; each booted world gets its own instance.
 */
export function createAnalyticsSystem(): System {
  let pendingMilestones: string[] = [];
  let pendingControls: EventPayload[] = [];
  let unsubscribes: (() => void)[] = [];
  let stateEntity: EntityId | null = null;

  const reset = () => {
    pendingMilestones = [];
    pendingControls = [];
    stateEntity = null;
  };

  return {
    id: 'analytics',
    dependencies: [],
    init(context: SystemContext): void {
      reset();
      // The analytics slice: adopt (hot re-init or restored save) or spawn
      // with capture on and an empty funnel. Sole writer (FR-ARCH-015).
      const existing = context.world.query(ANALYTICS_STATE)[0];
      if (existing === undefined) {
        stateEntity = context.world.createEntity();
        context.world.addComponent(stateEntity, ANALYTICS_STATE, DEFAULT_ANALYTICS_STATE);
      } else {
        stateEntity = existing;
      }
      for (const binding of FUNNEL_BINDINGS) {
        unsubscribes.push(
          context.events.subscribe(binding.type, (event) => {
            if (binding.matches === undefined || binding.matches(event.payload)) {
              pendingMilestones.push(binding.milestone);
            }
          }),
        );
      }
      unsubscribes.push(
        context.events.subscribe(ANALYTICS_CONTROL, (event) => {
          pendingControls.push(event.payload);
        }),
      );
    },
    update(_dt: number, context: SystemContext): void {
      if (stateEntity === null) return;
      const world = context.world;
      let state = world.getComponent(stateEntity, ANALYTICS_STATE) ?? DEFAULT_ANALYTICS_STATE;
      const before = state;

      for (const control of pendingControls) state = mergeControl(state, control);
      pendingControls = [];

      if (state.enabled && pendingMilestones.length > 0) {
        const sink = telemetryOf(context.platform);
        for (const milestone of pendingMilestones) {
          if (state.milestones[milestone] !== undefined) continue; // funnel: first only
          const at = context.time.now;
          state = { ...state, milestones: { ...state.milestones, [milestone]: at } };
          // The metric is the milestone name plus simulation seconds —
          // nothing else crosses this boundary; no sink means no capture,
          // never a fault (FR-ARCH-008).
          sink?.record(`${FUNNEL_METRIC_PREFIX}${milestone}`, at);
        }
      }
      // Disabled (or already-counted) hits drop on the floor: capture off
      // means off, retroactively firing nothing on re-enable.
      pendingMilestones = [];

      if (state !== before) {
        world.addComponent(stateEntity, ANALYTICS_STATE, state);
      }
    },
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      reset();
    },
  };
}

/**
 * The analytics plugin: the System plus the slice component and control
 * event it introduces, registered and removed as one unit (FR-ARCH-018).
 * A factory so every world composes a fresh System instance.
 */
export function createAnalyticsPlugin(): Plugin {
  return {
    id: 'plugin.analytics',
    systems: [createAnalyticsSystem()],
    componentTypes: [ANALYTICS_STATE],
    eventTypes: [ANALYTICS_CONTROL],
  };
}
