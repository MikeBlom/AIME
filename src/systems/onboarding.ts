/**
 * Onboarding System — diegetic first-session guidance (issue #44; spec:
 * docs/19-Onboarding-and-First-Session.md).
 *
 * Guidance is a set of one-shot **cues** that ride the UI hint line — the
 * non-blocking channel docs/18 reserves for FR-VIS-009 — so the player is
 * never lost and never interrupted: no modal tutorial, no text wall, no
 * separate tutorial mode. Cues are driven purely by world state and bus
 * events: arrival raises a welcome, sustained stillness nudges movement,
 * movement without interaction nudges interaction, and a player adrift
 * mid-session (idle with a quest still open) is re-oriented toward the
 * objective. Each skill demonstrated cancels its nudge instantly — teaching
 * by consequence, never by instruction (Vision, Implementation Notes).
 *
 * The engine names only generic cue keys (`onboarding.hint.*`), following
 * the `ui.prompt.interact` precedent: the pack supplies the words, and a
 * pack that ships no onboarding strings simply shows nothing (FR-UI-006,
 * FR-ARCH-008). Cue timings are tuned so a fully passive first session
 * receives every beat inside the first minute (NFR-VIS-006).
 *
 * Politeness: a cue never fires while a modal surface is open and never
 * stomps a hint some other System raised; it clears only the hint it set.
 * The one-shot flags live in the ONBOARDING_STATE slice this System owns
 * (FR-ARCH-015), persisted with the save envelope so a returning visitor
 * is not re-welcomed. Determinism (NFR-ARCH-001): update reads only world
 * state, buffered events, and `dt` — no clocks, no randomness.
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import { BUILDING_ENTERED } from './building';
import { DIALOGUE_STARTED } from './dialogue';
import { INTENT_INTERACT } from './input';
import { MINIGAME_STARTED } from './minigame';
import { QUEST_ADVANCED, QUEST_COMPLETED, QUEST_STATE, SYSTEM_RESTORED } from './quest';
import { MOVEMENT_STARTED } from './scene';
import { UI_HINT, UI_STATE } from './ui';

/** The guidance beats the engine understands; their words are pack content. */
export type CueId = 'welcome' | 'move' | 'interact' | 'objective';

/**
 * The onboarding slice this System owns (FR-ARCH-015): which one-shot
 * beats have landed and which skills the player has demonstrated. Plain
 * serializable data, captured by the save envelope (FR-ARCH-016) so a
 * return visit replays no welcome and no mastered nudge.
 */
export type OnboardingState = {
  readonly welcomed: boolean;
  readonly moved: boolean;
  readonly interacted: boolean;
  readonly nudgedMove: boolean;
  readonly nudgedInteract: boolean;
};
export const ONBOARDING_STATE = defineComponentType<OnboardingState>('onboarding-state');

export const FRESH_ONBOARDING: OnboardingState = {
  welcomed: false,
  moved: false,
  interacted: false,
  nudgedMove: false,
  nudgedInteract: false,
};

/**
 * A guidance beat landed (deferred): which cue and which locale key rode
 * the hint line. A feedback feed for any consumer (audio, analytics), like
 * `achievement.unlocked` (FR-ARCH-005).
 */
export const ONBOARDING_CUE = defineEventType<{
  readonly cueId: CueId;
  readonly textKey: string;
}>('onboarding.cue');

/** Engine-named cue keys; their text is pack content (DATA-FR-011). */
export const ONBOARDING_WELCOME_KEY = 'onboarding.hint.welcome';
export const ONBOARDING_MOVE_KEY = 'onboarding.hint.move';
export const ONBOARDING_INTERACT_KEY = 'onboarding.hint.interact';
export const ONBOARDING_OBJECTIVE_KEY = 'onboarding.hint.objective';

const CUE_KEYS: { readonly [cue in CueId]: string } = {
  welcome: ONBOARDING_WELCOME_KEY,
  move: ONBOARDING_MOVE_KEY,
  interact: ONBOARDING_INTERACT_KEY,
  objective: ONBOARDING_OBJECTIVE_KEY,
};

/**
 * The first-minute budget, in simulation seconds (NFR-VIS-006): welcome
 * lands moments after arrival; a player who never touches the controls is
 * nudged to move by :08 and to interact by :20; every beat clears itself.
 */
export const WELCOME_DELAY_SECONDS = 1.5;
export const MOVE_NUDGE_SECONDS = 8;
export const INTERACT_NUDGE_SECONDS = 12;
/** Idle span (no input, no progress) before re-orienting toward the arc. */
export const ADRIFT_SECONDS = 45;
/** How long a cue rides the hint line before clearing itself. */
export const CUE_SECONDS = 6;

/** The onboarding slice, fresh when no entity carries it yet. */
function stateOf(world: EntityStore): { entity: EntityId; state: OnboardingState } | null {
  for (const entity of world.query(ONBOARDING_STATE)) {
    const state = world.getComponent(entity, ONBOARDING_STATE);
    if (state !== undefined) return { entity, state };
  }
  return null;
}

/** The UI slice, if a UI System owns one this world (FR-ARCH-008). */
function uiOf(world: EntityStore): { hint: string | null; modal: boolean } | null {
  for (const entity of world.query(UI_STATE)) {
    const state = world.getComponent(entity, UI_STATE);
    if (state !== undefined) return { hint: state.hint, modal: state.modal };
  }
  return null;
}

/** Is any quest still open, so an adrift player has somewhere to go? */
function questOpen(world: EntityStore): boolean {
  for (const entity of world.query(QUEST_STATE)) {
    if (world.getComponent(entity, QUEST_STATE)?.status === 'active') return true;
  }
  return false;
}

/**
 * Build the Onboarding System. A factory because the System buffers bus
 * events between flush and update and runs session timers in closure
 * state; each booted world composes a fresh instance (hot-reload safe).
 */
export function createOnboardingSystem(): System {
  // Session-transient timers (presentation of guidance, not progression):
  // deterministic accumulations of dt, reset by init like a toast countdown.
  let elapsed = 0;
  let sinceMoved = 0;
  let idle = 0;
  let cueRemaining = 0;
  let activeKey: string | null = null;
  // Flags buffered from deferred events between flushes (FR-ARCH-012).
  let sawMovement = false;
  let sawInteraction = false;
  let sawProgress = false;
  let unsubscribes: (() => void)[] = [];

  const reset = () => {
    elapsed = 0;
    sinceMoved = 0;
    idle = 0;
    cueRemaining = 0;
    activeKey = null;
    sawMovement = false;
    sawInteraction = false;
    sawProgress = false;
  };

  return {
    id: 'onboarding',
    // Ordering only: read the UI slice the UI System settled this step, so
    // modality and hint occupancy are current. A world without a UI System
    // shows no hints but keeps its state honestly (FR-ARCH-008).
    dependencies: ['ui'],
    init(context: SystemContext): void {
      reset();
      if (stateOf(context.world) === null) {
        context.world.addComponent(
          context.world.createEntity(),
          ONBOARDING_STATE,
          FRESH_ONBOARDING,
        );
      }
      const events = context.events;
      unsubscribes.push(
        events.subscribe(MOVEMENT_STARTED, () => {
          sawMovement = true;
        }),
        events.subscribe(INTENT_INTERACT, () => {
          sawInteraction = true;
        }),
        events.subscribe(DIALOGUE_STARTED, () => {
          sawInteraction = true;
        }),
        events.subscribe(MINIGAME_STARTED, () => {
          sawProgress = true;
        }),
        events.subscribe(BUILDING_ENTERED, () => {
          sawProgress = true;
        }),
        events.subscribe(QUEST_ADVANCED, () => {
          sawProgress = true;
        }),
        events.subscribe(QUEST_COMPLETED, () => {
          sawProgress = true;
        }),
        events.subscribe(SYSTEM_RESTORED, () => {
          sawProgress = true;
        }),
      );
    },
    update(dt: number, context: SystemContext): void {
      const world = context.world;
      const slice = stateOf(world);
      if (slice === null) return;
      let state = slice.state;

      // 1. Fold this step's buffered activity into the skill record and
      //    the idle clock; demonstrated skills cancel their nudge at once.
      const active = sawMovement || sawInteraction || sawProgress;
      if (sawMovement && !state.moved) state = { ...state, moved: true };
      if (sawInteraction && !state.interacted) state = { ...state, interacted: true };
      if (state !== slice.state) world.addComponent(slice.entity, ONBOARDING_STATE, state);

      elapsed += dt;
      sinceMoved = state.moved ? sinceMoved + dt : 0;
      idle = active ? 0 : idle + dt;

      const cancelActive =
        (sawMovement && activeKey === ONBOARDING_MOVE_KEY) ||
        (sawInteraction && activeKey === ONBOARDING_INTERACT_KEY) ||
        (active && activeKey === ONBOARDING_OBJECTIVE_KEY);
      sawMovement = false;
      sawInteraction = false;
      sawProgress = false;

      // 2. Run down the active cue; clear only the hint this System set,
      //    and only if no other System has replaced it meanwhile.
      const ui = uiOf(world);
      if (activeKey !== null) {
        cueRemaining = cancelActive ? 0 : Math.max(0, cueRemaining - dt);
        if (cueRemaining === 0) {
          if (ui === null || ui.hint === activeKey) {
            context.events.publish(UI_HINT, { textKey: null });
          }
          activeKey = null;
        }
        return; // one cue at a time; the next beat waits its turn
      }

      // 3. Politeness: never speak over a modal surface or a hint some
      //    other System (an achievement toast, say) is showing.
      if (ui !== null && (ui.modal || ui.hint !== null)) return;

      // 4. The next due beat, in arc order (one per step at most).
      let cue: CueId | null = null;
      if (!state.welcomed && elapsed >= WELCOME_DELAY_SECONDS) {
        cue = 'welcome';
        state = { ...state, welcomed: true };
      } else if (!state.moved && !state.nudgedMove && elapsed >= MOVE_NUDGE_SECONDS) {
        cue = 'move';
        state = { ...state, nudgedMove: true };
      } else if (
        state.moved &&
        !state.interacted &&
        !state.nudgedInteract &&
        sinceMoved >= INTERACT_NUDGE_SECONDS
      ) {
        cue = 'interact';
        state = { ...state, nudgedInteract: true };
      } else if (idle >= ADRIFT_SECONDS && questOpen(world)) {
        // Re-armable: another adrift span re-orients again (never lost).
        cue = 'objective';
        idle = 0;
      }
      if (cue === null) return;

      world.addComponent(slice.entity, ONBOARDING_STATE, state);
      const textKey = CUE_KEYS[cue];
      context.events.publish(UI_HINT, { textKey });
      context.events.publish(ONBOARDING_CUE, { cueId: cue, textKey });
      activeKey = textKey;
      cueRemaining = CUE_SECONDS;
    },
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      reset();
    },
  };
}

/**
 * The onboarding plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createOnboardingPlugin(): Plugin {
  return {
    id: 'plugin.onboarding',
    systems: [createOnboardingSystem()],
    componentTypes: [ONBOARDING_STATE],
    eventTypes: [ONBOARDING_CUE],
  };
}
