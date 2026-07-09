/**
 * UI / HUD System — the diegetic, minimal interface layer above the world
 * (issue #23; spec: docs/18-UI-UX-and-HUD.md).
 *
 * Split across the loop's two phases like rendering: the fixed-step
 * `update` maintains the UI slice this System owns (FR-ARCH-015) — the
 * proximity-driven interaction prompt, the ambient hint line, and the
 * dialogue surface — from world state and buffered bus events. The
 * presentation phase calls the pure `uiFrame` pass, which draws the slice
 * above the world through the adapter surface with a responsive layout.
 *
 * Every player-visible string is a locale key resolved through the pack's
 * strings table in world state (DATA-FR-011); a key the table does not
 * define draws nothing — the engine names no career fact and ships no
 * sentence. Input routing never steals gameplay input: the System writes
 * no input slice and suppresses no intent; while a dialogue is open it
 * *additionally* reacts to interact (advance/close) and vertical move
 * edges (choice selection), and downstream world-interaction Systems can
 * honor the slice's `modal` flag by world-state query, never by call
 * (FR-ARCH-005). Determinism (NFR-ARCH-001): update reads only world
 * state, buffered events, and the intent slice — no clocks, no randomness.
 */
import type { EntityId, EntityStore, EventPayload, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import type { RenderSurface } from '../platform';
import { THEME } from '../style';
import { INPUT_INTENT, INTENT_INTERACT } from './input';
import { PLAYER_CONTROLLED, POSITION, RENDERABLE, spaceOf } from './scene';

/**
 * The pack's default-locale strings (locale key → localized text), landed
 * in world state at spawn exactly like the asset manifest, so UI resolves
 * player-visible text without reaching into the content graph.
 */
export type LocaleStrings = { readonly entries: { readonly [key: string]: string } };
export const LOCALE_STRINGS = defineComponentType<LocaleStrings>('locale-strings');

/** The dialogue surface: a speaker line plus optional player choices. */
export type DialogueSurface = {
  readonly textKey: string;
  readonly choiceKeys: readonly string[];
  readonly selected: number;
};

/**
 * The UI slice, owned by this System (FR-ARCH-015): the active interaction
 * prompt and hint (locale keys, null when hidden), the open dialogue
 * surface, and `modal` — true while a surface wants the interact intent,
 * which world-interaction Systems honor by query, never by call.
 */
export type UiState = {
  readonly prompt: string | null;
  readonly hint: string | null;
  readonly dialogue: DialogueSurface | null;
  readonly modal: boolean;
};
export const UI_STATE = defineComponentType<UiState>('ui-state');

export const IDLE_UI_STATE: UiState = { prompt: null, hint: null, dialogue: null, modal: false };

/** Show (or clear, with null) the ambient hint line (FR-VIS-009). */
export const UI_HINT = defineEventType<{ readonly textKey: string | null }>('ui.hint');

/** Open the dialogue surface; any System may request it (FR-ARCH-005). */
export const UI_DIALOGUE_OPEN = defineEventType<{
  readonly textKey: string;
  readonly choiceKeys?: readonly string[];
}>('ui.dialogue.open');

/** Close the dialogue surface without a player choice. */
export const UI_DIALOGUE_CLOSE = defineEventType<Record<string, never>>('ui.dialogue.close');

/**
 * Announced when the player closes a dialogue: which line was showing and
 * which choice (key and index) was selected, null for a plain dismiss.
 * Dialogue logic (a future Dialogue System) consumes this to advance.
 */
export const UI_DIALOGUE_CHOSEN = defineEventType<{
  readonly textKey: string;
  readonly choiceKey: string | null;
  readonly choiceIndex: number | null;
}>('ui.dialogue.chosen');

/** The engine-named prompt key; its text is pack content (DATA-FR-011). */
export const UI_PROMPT_INTERACT_KEY = 'ui.prompt.interact';

/** Logical-unit radius within which a marker raises the interact prompt. */
export const PROMPT_RADIUS = 28;

/** Renderable kinds that raise the proximity prompt (generic scene roles). */
const PROMPTING_KINDS: ReadonlySet<string> = new Set(['npc', 'building']);

/** Chrome roles resolved from the theme (FR-ART-001): scrim, hairline,
 * body text, muted choices, and the shared accent for the selection. */
const PANEL_COLOR = THEME.palette.panel;
const PANEL_EDGE_COLOR = THEME.palette.panelEdge;
const TEXT_COLOR = THEME.palette.text;
const CHOICE_COLOR = THEME.palette.textMuted;
const CHOICE_SELECTED_COLOR = THEME.palette.accent;

function stringsOf(world: EntityStore): { readonly [key: string]: string } {
  return (
    world
      .query(LOCALE_STRINGS)
      .map((entity) => world.getComponent(entity, LOCALE_STRINGS)?.entries)
      .find((entries) => entries !== undefined) ?? {}
  );
}

/** The player's entity and position, from the first player-controlled one. */
function playerView(world: EntityStore): { entity: EntityId; x: number; y: number } | null {
  for (const entity of world.query(PLAYER_CONTROLLED, POSITION)) {
    const position = world.getComponent(entity, POSITION);
    if (position !== undefined) return { entity, x: position.x, y: position.y };
  }
  return null;
}

/** True when a prompting marker sits within PROMPT_RADIUS of the player. */
function nearInteractable(world: EntityStore): boolean {
  const player = playerView(world);
  if (player === null) return false;
  const playerSpace = spaceOf(world, player.entity);
  for (const entity of world.query(POSITION, RENDERABLE)) {
    const renderable = world.getComponent(entity, RENDERABLE);
    if (renderable === undefined || !PROMPTING_KINDS.has(renderable.kind)) continue;
    // Markers in another space (an interior while outdoors, the exterior
    // while inside) never prompt (issue #30).
    if (spaceOf(world, entity) !== playerSpace) continue;
    const position = world.getComponent(entity, POSITION);
    if (position === undefined) continue;
    const dx = position.x - player.x;
    const dy = position.y - player.y;
    if (dx * dx + dy * dy <= PROMPT_RADIUS * PROMPT_RADIUS) return true;
  }
  return false;
}

function sameDialogue(a: DialogueSurface | null, b: DialogueSurface | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.textKey === b.textKey &&
    a.selected === b.selected &&
    a.choiceKeys.length === b.choiceKeys.length &&
    a.choiceKeys.every((key, index) => key === b.choiceKeys[index])
  );
}

/**
 * Build the UI System. A factory (not a shared instance) because the
 * System buffers events between flush and update and tracks intent edges;
 * each booted world gets its own instance so state never bleeds across
 * worlds.
 */
export function createUiSystem(): System {
  type PendingDialogue =
    | { readonly kind: 'open'; readonly textKey: string; readonly choiceKeys: readonly string[] }
    | { readonly kind: 'close' };
  let pendingDialogue: PendingDialogue[] = [];
  let pendingHints: (string | null)[] = [];
  let pendingInteracts = 0;
  let lastMoveY = 0;
  let unsubscribes: (() => void)[] = [];
  let stateEntity: EntityId | null = null;

  const reset = () => {
    pendingDialogue = [];
    pendingHints = [];
    pendingInteracts = 0;
    lastMoveY = 0;
    stateEntity = null;
  };

  const keysOf = (payload: EventPayload): readonly string[] => {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
    const value = (payload as { readonly [key: string]: EventPayload })['choiceKeys'];
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === 'string')
      : [];
  };

  return {
    id: 'ui',
    // Ordering only: read the intent slice the Input System resolved this
    // step. A world without an Input System still shows prompts and
    // dialogue (FR-ARCH-008).
    dependencies: ['input'],
    init(context: SystemContext): void {
      reset();
      // The UI slice: adopt an existing entity (hot re-init) or spawn one
      // idle. This System is its sole writer (FR-ARCH-015).
      const existing = context.world.query(UI_STATE)[0];
      if (existing === undefined) {
        stateEntity = context.world.createEntity();
        context.world.addComponent(stateEntity, UI_STATE, IDLE_UI_STATE);
      } else {
        stateEntity = existing;
      }
      unsubscribes.push(
        context.events.subscribe(UI_DIALOGUE_OPEN, (event) => {
          if (typeof event.payload.textKey !== 'string' || event.payload.textKey === '') return;
          pendingDialogue.push({
            kind: 'open',
            textKey: event.payload.textKey,
            choiceKeys: keysOf(event.payload),
          });
        }),
      );
      unsubscribes.push(
        context.events.subscribe(UI_DIALOGUE_CLOSE, () => {
          pendingDialogue.push({ kind: 'close' });
        }),
      );
      unsubscribes.push(
        context.events.subscribe(UI_HINT, (event) => {
          const key = event.payload.textKey;
          if (key === null || (typeof key === 'string' && key !== '')) pendingHints.push(key);
        }),
      );
      unsubscribes.push(
        context.events.subscribe(INTENT_INTERACT, () => {
          pendingInteracts += 1;
        }),
      );
    },
    update(_dt: number, context: SystemContext): void {
      if (stateEntity === null) return;
      const world = context.world;
      const state = world.getComponent(stateEntity, UI_STATE) ?? IDLE_UI_STATE;

      let dialogue = state.dialogue;
      let hint = state.hint;

      // Requested surface changes, in arrival order (deterministic).
      for (const request of pendingDialogue) {
        dialogue =
          request.kind === 'open'
            ? { textKey: request.textKey, choiceKeys: request.choiceKeys, selected: 0 }
            : null;
      }
      pendingDialogue = [];
      for (const key of pendingHints) hint = key;
      pendingHints = [];

      // Choice selection: vertical move-intent edges cycle the selection.
      // Movement itself is untouched — the intent slice is read, never
      // written, so a dialogue never blocks walking (AC1).
      const intent = (() => {
        for (const entity of world.query(INPUT_INTENT)) {
          const value = world.getComponent(entity, INPUT_INTENT);
          if (value !== undefined) return value;
        }
        return null;
      })();
      const moveY = Math.sign(intent?.moveY ?? 0);
      if (dialogue !== null && dialogue.choiceKeys.length > 0 && moveY !== 0 && lastMoveY === 0) {
        const count = dialogue.choiceKeys.length;
        dialogue = { ...dialogue, selected: (dialogue.selected + moveY + count) % count };
      }
      lastMoveY = moveY;

      // Interact while a dialogue is open advances it: announce the choice
      // and close. Interacts with no dialogue open belong to the world;
      // this System ignores them (never steals gameplay input).
      if (pendingInteracts > 0 && dialogue !== null) {
        const hasChoices = dialogue.choiceKeys.length > 0;
        context.events.publish(UI_DIALOGUE_CHOSEN, {
          textKey: dialogue.textKey,
          choiceKey: hasChoices ? (dialogue.choiceKeys[dialogue.selected] ?? null) : null,
          choiceIndex: hasChoices ? dialogue.selected : null,
        });
        dialogue = null;
      }
      pendingInteracts = 0;

      // The proximity prompt appears beside reachable markers and hides
      // while a modal surface is open (AC1: appear/disappear correctly).
      const prompt = dialogue === null && nearInteractable(world) ? UI_PROMPT_INTERACT_KEY : null;

      const next: UiState = { prompt, hint, dialogue, modal: dialogue !== null };
      if (
        next.prompt !== state.prompt ||
        next.hint !== state.hint ||
        next.modal !== state.modal ||
        !sameDialogue(next.dialogue, state.dialogue)
      ) {
        world.addComponent(stateEntity, UI_STATE, next);
      }
    },
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      reset();
    },
  };
}

/** Responsive chrome metrics derived from the surface size. */
export function uiLayout(surface: { readonly width: number; readonly height: number }): {
  fontPx: number;
  pad: number;
  panelWidth: number;
} {
  const fontPx = Math.min(22, Math.max(11, Math.round(surface.height * 0.045)));
  const pad = Math.round(fontPx * 0.6);
  const panelWidth = Math.min(surface.width - 2 * pad, Math.max(240, surface.width * 0.6));
  return { fontPx, pad, panelWidth: Math.max(0, panelWidth) };
}

/**
 * Draw one presentation frame of UI above the world: the hint line (top
 * center), the interaction prompt (bottom center pill), and the dialogue
 * surface (bottom panel with text and choices). Pure with respect to world
 * state — it only reads the UI slice and the strings table, so
 * presentation cadence cannot perturb simulation (FR-ARCH-025). Text is
 * resolved from locale keys; an unresolved key draws nothing, never a raw
 * key and never a fault (FR-ARCH-008, DATA-FR-011).
 */
export function uiFrame(context: SystemContext, render: RenderSurface): void {
  const world = context.world;
  const state =
    world
      .query(UI_STATE)
      .map((entity) => world.getComponent(entity, UI_STATE))
      .find((value) => value !== undefined) ?? IDLE_UI_STATE;
  if (state.prompt === null && state.hint === null && state.dialogue === null) return;

  const strings = stringsOf(world);
  const surface = render.size();
  const { fontPx, pad, panelWidth } = uiLayout(surface);
  const centerX = surface.width / 2;

  if (state.hint !== null) {
    const text = strings[state.hint];
    if (text !== undefined) {
      render.drawText(text, centerX, pad, { color: CHOICE_COLOR, sizePx: fontPx, align: 'center' });
    }
  }

  if (state.dialogue !== null) {
    const text = strings[state.dialogue.textKey];
    const choices = state.dialogue.choiceKeys.map((key) => strings[key]);
    const lines = 1 + choices.filter((choice) => choice !== undefined).length;
    const lineHeight = Math.round(fontPx * 1.5);
    const panelHeight = lines * lineHeight + 2 * pad;
    const left = centerX - panelWidth / 2;
    const top = surface.height - panelHeight - pad;
    render.fillRect(left, top, panelWidth, panelHeight, PANEL_COLOR);
    render.drawLine(left, top, left + panelWidth, top, PANEL_EDGE_COLOR);
    let y = top + pad;
    if (text !== undefined) {
      render.drawText(text, left + pad, y, { color: TEXT_COLOR, sizePx: fontPx });
    }
    y += lineHeight;
    choices.forEach((choice, index) => {
      if (choice === undefined) return;
      const selected = index === state.dialogue?.selected;
      render.drawText(choice, left + pad * 2, y, {
        color: selected ? CHOICE_SELECTED_COLOR : CHOICE_COLOR,
        sizePx: fontPx,
      });
      y += lineHeight;
    });
    return; // The dialogue panel replaces the prompt pill (modal surface).
  }

  if (state.prompt !== null) {
    const text = strings[state.prompt];
    if (text !== undefined) {
      const pillHeight = fontPx + 2 * pad;
      const pillWidth = Math.min(panelWidth, Math.max(120, text.length * fontPx * 0.62));
      const top = surface.height - pillHeight - pad;
      render.fillRect(centerX - pillWidth / 2, top, pillWidth, pillHeight, PANEL_COLOR);
      render.drawText(text, centerX, top + pad, {
        color: TEXT_COLOR,
        sizePx: fontPx,
        align: 'center',
      });
    }
  }
}

/**
 * The UI plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance.
 */
export function createUiPlugin(): Plugin {
  return {
    id: 'plugin.ui',
    systems: [createUiSystem()],
    componentTypes: [UI_STATE, LOCALE_STRINGS],
    eventTypes: [UI_HINT, UI_DIALOGUE_OPEN, UI_DIALOGUE_CLOSE, UI_DIALOGUE_CHOSEN],
  };
}
