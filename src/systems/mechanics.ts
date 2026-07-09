/**
 * Mechanic types — the mini-game catalog (issue #34; spec:
 * docs/29-Mini-Games-Catalog.md), built on the host contract from
 * docs/28-Mini-Games-Framework.md.
 *
 * Each mechanic is a metaphor *primitive* the pack binds accomplishments
 * to (DATA-FR-009): route-and-balance (distribute load under capacity),
 * assembly (build in the right order), orchestrate (coordinate timing).
 * What any of them *means* is entirely the pack's business — this module
 * holds rules, never framing (FR-VIS-007).
 *
 * All three share one control vocabulary read from the input-intent slice
 * (docs/14): move edges select, interact acts, and holding interact for a
 * configurable span resolves the session as `bypass`, so comprehension is
 * never gated behind skill (FR-VIS-010). Play state lives in a
 * mechanic-owned world slice (FR-ARCH-015) so UI can draw meters without
 * coupling; every beat is announced as `minigame.feedback` for the
 * presentation layers to polish. Deterministic by construction: state
 * advances only on the input snapshot and simulation `dt` (NFR-ARCH-001).
 */
import type { ComponentData, ComponentType, EntityId, Plugin, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { INPUT_INTENT } from './input';
import type { MechanicOutcome, MechanicSpec, MinigameSession } from './minigame';
import { createMechanicSystem } from './minigame';

/** The catalog's engine mechanic ids, referenceable by `metaphor` content. */
export const MECHANIC_ROUTE_AND_BALANCE = 'engine.mechanic.route-and-balance';
export const MECHANIC_ASSEMBLY = 'engine.mechanic.assembly';
export const MECHANIC_ORCHESTRATE = 'engine.mechanic.orchestrate';

/**
 * A gameplay beat inside a mini-game, published deferred for presentation
 * Systems to polish (audio cue, meter, flash) without coupling: `progress`
 * moves toward completion (`ratio` is 0..1 done), `setback` is a rejected
 * or mistimed action.
 */
export const MINIGAME_FEEDBACK = defineEventType<{
  readonly mechanicId: string;
  readonly questId: string;
  readonly kind: 'progress' | 'setback';
  readonly ratio: number;
}>('minigame.feedback');

/** Simulation seconds of continuously held interact that resolve `bypass`. */
export const DEFAULT_BYPASS_HOLD_SECONDS = 3;

/** The input edges shared by every catalog mechanic, computed per step. */
type ControlEdges = {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly act: boolean;
  readonly interactHeld: boolean;
};

/** The previous-intent sample edge detection compares against. */
type IntentSample = {
  readonly moveX: number;
  readonly moveY: number;
  readonly interact: boolean;
};

/** Baseline that swallows a press still held from before the session. */
const HELD_BASELINE: IntentSample = { moveX: 0, moveY: 0, interact: true };

function readEdges(context: SystemContext, previous: IntentSample): [ControlEdges, IntentSample] {
  const entity = context.world.query(INPUT_INTENT)[0];
  const intent =
    entity === undefined ? undefined : context.world.getComponent(entity, INPUT_INTENT);
  const sample: IntentSample = {
    moveX: intent?.moveX ?? 0,
    moveY: intent?.moveY ?? 0,
    interact: intent?.interact ?? false,
  };
  const edges: ControlEdges = {
    left: sample.moveX === -1 && previous.moveX !== -1,
    right: sample.moveX === 1 && previous.moveX !== 1,
    up: sample.moveY === -1 && previous.moveY !== -1,
    down: sample.moveY === 1 && previous.moveY !== 1,
    act: sample.interact && !previous.interact,
    interactHeld: sample.interact,
  };
  return [edges, sample];
}

/** Defensive param readers: content is validated, defaults still guard. */
function numberParam(params: MinigameSession['params'], key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberListParam(
  params: MinigameSession['params'],
  key: string,
  fallback: readonly number[],
): readonly number[] {
  const value = params[key];
  if (!Array.isArray(value)) return fallback;
  const numbers = value.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0,
  );
  return numbers.length > 0 ? numbers : fallback;
}

function feedback(
  context: SystemContext,
  session: MinigameSession,
  kind: 'progress' | 'setback',
  ratio: number,
): void {
  context.events.publish(MINIGAME_FEEDBACK, {
    mechanicId: session.mechanicId,
    questId: session.questId,
    kind,
    ratio,
  });
}

/**
 * The shared session scaffold: keeps the previous intent sample for edge
 * detection and the bypass hold accumulator, and owns resetting the
 * mechanic's play-state slice on enter and clearing it on exit. `step`
 * is the mechanic's rules; the scaffold is everything else.
 */
function catalogMechanic<T extends ComponentData>(options: {
  readonly mechanicId: string;
  readonly stateType: ComponentType<T>;
  readonly reset: (session: MinigameSession) => T;
  readonly step: (
    dt: number,
    state: T,
    edges: ControlEdges,
    session: MinigameSession,
    context: SystemContext,
  ) => { readonly state: T; readonly outcome?: MechanicOutcome };
}): MechanicSpec {
  let stateEntity: EntityId | null = null;
  let previous: IntentSample = HELD_BASELINE;
  let holdSeconds = 0;
  return {
    mechanicId: options.mechanicId,
    enter(session, context): void {
      // Swallow the press that launched the session; edges need a release.
      previous = HELD_BASELINE;
      holdSeconds = 0;
      stateEntity = context.world.query(options.stateType)[0] ?? context.world.createEntity();
      context.world.addComponent(stateEntity, options.stateType, options.reset(session));
    },
    play(dt, session, context): MechanicOutcome | null {
      if (stateEntity === null) return null;
      const state = context.world.getComponent(stateEntity, options.stateType);
      if (state === undefined) return null;
      const [edges, sample] = readEdges(context, previous);
      previous = sample;

      // The uniform bypass affordance (FR-VIS-010): hold interact for the
      // configured span. Continuity required — releasing resets the hold.
      holdSeconds = edges.interactHeld ? holdSeconds + dt : 0;
      const bypassAfter = numberParam(
        session.params,
        'bypassHoldSeconds',
        DEFAULT_BYPASS_HOLD_SECONDS,
      );
      if (holdSeconds >= bypassAfter) return 'bypass';

      const result = options.step(dt, state, edges, session, context);
      if (result.state !== state) {
        context.world.addComponent(stateEntity, options.stateType, result.state);
      }
      return result.outcome ?? null;
    },
    exit(_result, context): void {
      if (stateEntity !== null) {
        context.world.removeComponent(stateEntity, options.stateType);
        stateEntity = null;
      }
      previous = HELD_BASELINE;
      holdSeconds = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Route and balance — distribute a load across channels under capacity.
// ---------------------------------------------------------------------------

/**
 * Play state for route-and-balance, a UI-drawable slice: per-channel
 * capacities and routed units, plus the selected channel.
 */
export type RouteBalanceState = {
  readonly capacities: readonly number[];
  readonly routed: readonly number[];
  readonly selected: number;
  readonly load: number;
};
export const ROUTE_BALANCE_STATE = defineComponentType<RouteBalanceState>('route-balance-state');

const ROUTE_DEFAULT_CAPACITIES: readonly number[] = [2, 2, 1];
const ROUTE_DEFAULT_LOAD = 4;

function resetRouteBalance(session: MinigameSession): RouteBalanceState {
  const capacities = numberListParam(session.params, 'channels', ROUTE_DEFAULT_CAPACITIES);
  const total = capacities.reduce((sum, capacity) => sum + capacity, 0);
  // A load the channels cannot hold is clamped so the puzzle stays solvable.
  const load = Math.min(numberParam(session.params, 'load', ROUTE_DEFAULT_LOAD), total);
  return { capacities, routed: capacities.map(() => 0), selected: 0, load };
}

/**
 * Route-and-balance rules: left/right select a channel, interact routes
 * one unit into it. A full channel rejects the unit (setback); routing the
 * whole load succeeds. Teaches distributing work under per-node capacity.
 */
function stepRouteBalance(
  _dt: number,
  state: RouteBalanceState,
  edges: ControlEdges,
  session: MinigameSession,
  context: SystemContext,
): { state: RouteBalanceState; outcome?: MechanicOutcome } {
  let next = state;
  if (edges.left || edges.right) {
    const count = state.capacities.length;
    const selected = (state.selected + (edges.right ? 1 : count - 1)) % count;
    next = { ...next, selected };
  }
  if (edges.act) {
    const routedTotal = next.routed.reduce((sum, units) => sum + units, 0);
    const channel = next.selected;
    if (routedTotal < next.load && (next.routed[channel] ?? 0) < (next.capacities[channel] ?? 0)) {
      const routed = next.routed.map((units, index) => (index === channel ? units + 1 : units));
      next = { ...next, routed };
      const done = routedTotal + 1;
      feedback(context, session, 'progress', done / next.load);
      if (done >= next.load) return { state: next, outcome: 'success' };
    } else {
      feedback(context, session, 'setback', routedTotal / next.load);
    }
  }
  return { state: next };
}

// ---------------------------------------------------------------------------
// Assembly — build a sequence by placing the right part in each slot.
// ---------------------------------------------------------------------------

/**
 * Play state for assembly: the content-declared correct choice per slot,
 * how many slots are placed, the offered choice count, and the selection.
 */
export type AssemblyState = {
  readonly slots: readonly number[];
  readonly placed: number;
  readonly choices: number;
  readonly selected: number;
};
export const ASSEMBLY_STATE = defineComponentType<AssemblyState>('assembly-state');

const ASSEMBLY_DEFAULT_SLOTS: readonly number[] = [1, 0, 2];
const ASSEMBLY_DEFAULT_CHOICES = 3;

function resetAssembly(session: MinigameSession): AssemblyState {
  const choices = Math.max(
    2,
    Math.floor(numberParam(session.params, 'choices', ASSEMBLY_DEFAULT_CHOICES)),
  );
  const declared = session.params['slots'];
  const slots = (
    Array.isArray(declared)
      ? declared.filter(
          (item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0,
        )
      : []
  ).map((slot) => slot % choices);
  return {
    slots: slots.length > 0 ? slots : ASSEMBLY_DEFAULT_SLOTS.map((slot) => slot % choices),
    placed: 0,
    choices,
    selected: 0,
  };
}

/**
 * Assembly rules: up/down cycle the offered part, interact places it in
 * the current slot. The right part advances (progress); the wrong one is
 * rejected (setback) and the slot stays open. Teaches building a whole in
 * the right order.
 */
function stepAssembly(
  _dt: number,
  state: AssemblyState,
  edges: ControlEdges,
  session: MinigameSession,
  context: SystemContext,
): { state: AssemblyState; outcome?: MechanicOutcome } {
  let next = state;
  if (edges.up || edges.down) {
    const selected = (state.selected + (edges.down ? 1 : state.choices - 1)) % state.choices;
    next = { ...next, selected };
  }
  if (edges.act && next.placed < next.slots.length) {
    if (next.selected === next.slots[next.placed]) {
      const placed = next.placed + 1;
      next = { ...next, placed };
      feedback(context, session, 'progress', placed / next.slots.length);
      if (placed >= next.slots.length) return { state: next, outcome: 'success' };
    } else {
      feedback(context, session, 'setback', next.placed / next.slots.length);
    }
  }
  return { state: next };
}

// ---------------------------------------------------------------------------
// Orchestrate — activate every track by acting inside its timing window.
// ---------------------------------------------------------------------------

/** One cycling track: its cycle length, open-window span, and live phase. */
export type OrchestrateTrack = {
  readonly periodSeconds: number;
  readonly windowSeconds: number;
  readonly phase: number;
  readonly active: boolean;
};

/** Play state for orchestrate: the tracks; the first inactive one is armed. */
export type OrchestrateState = { readonly tracks: readonly OrchestrateTrack[] };
export const ORCHESTRATE_STATE = defineComponentType<OrchestrateState>('orchestrate-state');

const ORCHESTRATE_DEFAULT_TRACKS: readonly { periodSeconds: number; windowSeconds: number }[] = [
  { periodSeconds: 2, windowSeconds: 0.5 },
  { periodSeconds: 3, windowSeconds: 0.5 },
];

function resetOrchestrate(session: MinigameSession): OrchestrateState {
  const declared = session.params['tracks'];
  const shapes = (Array.isArray(declared) ? declared : [])
    .map((item): Readonly<Record<string, ComponentData>> => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return {};
      return item as Readonly<Record<string, ComponentData>>;
    })
    .map((item) => ({
      periodSeconds:
        typeof item['periodSeconds'] === 'number' && item['periodSeconds'] > 0
          ? item['periodSeconds']
          : 0,
      windowSeconds:
        typeof item['windowSeconds'] === 'number' && item['windowSeconds'] > 0
          ? item['windowSeconds']
          : 0,
    }))
    .filter((item) => item.periodSeconds > 0 && item.windowSeconds > 0)
    // A window as long as its period would always be open; keep a beat shut.
    .map((item) => ({
      periodSeconds: item.periodSeconds,
      windowSeconds: Math.min(item.windowSeconds, item.periodSeconds / 2),
    }));
  const tracks = (shapes.length > 0 ? shapes : ORCHESTRATE_DEFAULT_TRACKS).map((shape) => ({
    ...shape,
    phase: 0,
    active: false,
  }));
  return { tracks };
}

/**
 * Orchestrate rules: every track's phase cycles on simulation time; the
 * first inactive track is armed. Acting while the armed track's window is
 * open activates it (progress); acting while it is shut is a setback.
 * Every track active at once succeeds. Teaches coordinating moving parts.
 */
function stepOrchestrate(
  dt: number,
  state: OrchestrateState,
  edges: ControlEdges,
  session: MinigameSession,
  context: SystemContext,
): { state: OrchestrateState; outcome?: MechanicOutcome } {
  let tracks = state.tracks.map((track) => ({
    ...track,
    phase: (track.phase + dt) % track.periodSeconds,
  }));
  if (edges.act) {
    const armed = tracks.findIndex((track) => !track.active);
    const track = tracks[armed];
    if (track !== undefined) {
      if (track.phase < track.windowSeconds) {
        tracks = tracks.map((entry, index) =>
          index === armed ? { ...entry, active: true } : entry,
        );
        const activeCount = tracks.filter((entry) => entry.active).length;
        feedback(context, session, 'progress', activeCount / tracks.length);
        if (activeCount >= tracks.length) {
          return { state: { tracks }, outcome: 'success' };
        }
      } else {
        const activeCount = tracks.filter((entry) => entry.active).length;
        feedback(context, session, 'setback', activeCount / tracks.length);
      }
    }
  }
  return { state: { tracks } };
}

// ---------------------------------------------------------------------------
// The catalog plugins.
// ---------------------------------------------------------------------------

/** Route-and-balance as a registrable mechanic plugin (FR-ARCH-018..020). */
export function createRouteAndBalancePlugin(): Plugin {
  return {
    id: `plugin.${MECHANIC_ROUTE_AND_BALANCE}`,
    dependencies: ['plugin.minigame-host'],
    systems: [
      createMechanicSystem(
        catalogMechanic({
          mechanicId: MECHANIC_ROUTE_AND_BALANCE,
          stateType: ROUTE_BALANCE_STATE,
          reset: resetRouteBalance,
          step: stepRouteBalance,
        }),
      ),
    ],
    componentTypes: [ROUTE_BALANCE_STATE],
    eventTypes: [MINIGAME_FEEDBACK],
  };
}

/** Assembly as a registrable mechanic plugin. */
export function createAssemblyPlugin(): Plugin {
  return {
    id: `plugin.${MECHANIC_ASSEMBLY}`,
    dependencies: ['plugin.minigame-host'],
    systems: [
      createMechanicSystem(
        catalogMechanic({
          mechanicId: MECHANIC_ASSEMBLY,
          stateType: ASSEMBLY_STATE,
          reset: resetAssembly,
          step: stepAssembly,
        }),
      ),
    ],
    componentTypes: [ASSEMBLY_STATE],
    eventTypes: [MINIGAME_FEEDBACK],
  };
}

/** Orchestrate as a registrable mechanic plugin. */
export function createOrchestratePlugin(): Plugin {
  return {
    id: `plugin.${MECHANIC_ORCHESTRATE}`,
    dependencies: ['plugin.minigame-host'],
    systems: [
      createMechanicSystem(
        catalogMechanic({
          mechanicId: MECHANIC_ORCHESTRATE,
          stateType: ORCHESTRATE_STATE,
          reset: resetOrchestrate,
          step: stepOrchestrate,
        }),
      ),
    ],
    componentTypes: [ORCHESTRATE_STATE],
    eventTypes: [MINIGAME_FEEDBACK],
  };
}
