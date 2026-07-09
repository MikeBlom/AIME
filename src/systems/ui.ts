/**
 * UI / HUD System — the diegetic, minimal interface layer above the world
 * (issue #23; spec: docs/18-UI-UX-and-HUD.md; accessibility surfaces per
 * issue #37, docs/34-Accessibility.md).
 *
 * Split across the loop's two phases like rendering: the fixed-step
 * `update` maintains the UI slice this System owns (FR-ARCH-015) — the
 * proximity-driven interaction prompt, the ambient hint line, the dialogue
 * surface, and the keyboard-operable settings/remap surface — from world
 * state and buffered bus events. The presentation phase calls the pure
 * `uiFrame` pass, which draws the slice above the world through the
 * adapter surface with a responsive layout.
 *
 * Every player-visible string is a locale key resolved through the pack's
 * strings table in world state (DATA-FR-011); a key the table does not
 * define draws nothing — the engine names no career fact and ships no
 * sentence. Input routing never steals gameplay input: the System writes
 * no input slice and suppresses no intent; while a dialogue or the
 * settings surface is open it *additionally* reacts to interact
 * (advance/activate) and vertical move edges (selection), and downstream
 * world-interaction Systems can honor the slice's `modal` flag by
 * world-state query, never by call (FR-ARCH-005).
 *
 * Narration (docs/34): the slice already carries exactly the strings a
 * screen reader needs, so this System announces essential changes —
 * prompts appearing, hints, dialogue lines and selections, the settings
 * rows — through the platform's narration channel whenever the
 * accessibility settings enable it. Like audio output, announcing is a
 * deterministic platform effect of update's inputs (NFR-ARCH-001): update
 * reads only world state, buffered events, and the intent slice — no
 * clocks, no randomness.
 */
import type { EntityId, EntityStore, EventPayload, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';
import type { NarrationChannel, RenderSurface } from '../platform';
import { THEME } from '../style';
import { accessibilitySettingsOf, ACCESSIBILITY_CONTROL, INPUT_REMAP } from './accessibility';
import {
  activeBindings,
  INPUT_CAPTURE,
  INPUT_INTENT,
  INPUT_KEY_CAPTURED,
  INTENT_INTERACT,
  INTENT_SETTINGS,
} from './input';
import { activeLocaleOf, availableLocales, LOCALE_SELECT, LOCALE_STRINGS } from './locale';
import type { LocaleStrings } from './locale';
import { PLAYER_CONTROLLED, POSITION, RENDERABLE, spaceOf } from './scene';

export { LOCALE_STRINGS };
export type { LocaleStrings };

/** The dialogue surface: a speaker line plus optional player choices. */
export type DialogueSurface = {
  readonly textKey: string;
  readonly choiceKeys: readonly string[];
  readonly selected: number;
};

/**
 * The settings surface (docs/34): the selected row index and, while
 * rebinding, the action listening for a captured key. Fully
 * keyboard-operable: vertical move edges select, interact activates.
 */
export type SettingsSurface = {
  readonly selected: number;
  readonly capture: string | null;
};

/**
 * The UI slice, owned by this System (FR-ARCH-015): the active interaction
 * prompt and hint (locale keys, null when hidden), the open dialogue and
 * settings surfaces, and `modal` — true while a surface wants the interact
 * intent, which world-interaction Systems honor by query, never by call.
 */
export type UiState = {
  readonly prompt: string | null;
  readonly hint: string | null;
  readonly dialogue: DialogueSurface | null;
  readonly settings: SettingsSurface | null;
  readonly modal: boolean;
};
export const UI_STATE = defineComponentType<UiState>('ui-state');

export const IDLE_UI_STATE: UiState = {
  prompt: null,
  hint: null,
  dialogue: null,
  settings: null,
  modal: false,
};

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

/** Engine-named settings chrome keys; their text is pack content. */
export const UI_SETTINGS_TITLE_KEY = 'ui.settings.title';
export const UI_SETTINGS_ON_KEY = 'ui.settings.on';
export const UI_SETTINGS_OFF_KEY = 'ui.settings.off';
export const UI_SETTINGS_REBIND_KEY = 'ui.settings.rebind';

/** One settings row: a toggle, the locale selector, or a remappable action. */
export type SettingsRow =
  | {
      readonly kind: 'toggle';
      readonly setting: 'reducedMotion' | 'narration';
      readonly labelKey: string;
    }
  | { readonly kind: 'locale'; readonly labelKey: string }
  | { readonly kind: 'remap'; readonly action: string; readonly labelKey: string };

/**
 * The settings rows, engine-defined by generic vocabulary (labels are
 * locale keys, values world state): the accessibility toggles, the locale
 * selector (issue #38 — interact cycles the pack's shipped locales), then
 * one remap row per rebindable action. The `settings` action itself is
 * not offered for remapping, so the surface can always be closed.
 */
export const SETTINGS_ROWS: readonly SettingsRow[] = [
  { kind: 'toggle', setting: 'reducedMotion', labelKey: 'ui.settings.reduced-motion' },
  { kind: 'toggle', setting: 'narration', labelKey: 'ui.settings.narration' },
  { kind: 'locale', labelKey: 'ui.settings.locale' },
  { kind: 'remap', action: 'move-left', labelKey: 'ui.settings.action.move-left' },
  { kind: 'remap', action: 'move-right', labelKey: 'ui.settings.action.move-right' },
  { kind: 'remap', action: 'move-up', labelKey: 'ui.settings.action.move-up' },
  { kind: 'remap', action: 'move-down', labelKey: 'ui.settings.action.move-down' },
  { kind: 'remap', action: 'interact', labelKey: 'ui.settings.action.interact' },
];

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

/** Narrow the open platform record to a NarrationChannel; null is silent. */
function narrationOf(platform: SystemContext['platform']): NarrationChannel | null {
  const candidate = (platform as { readonly narration?: unknown }).narration;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as NarrationChannel).announce === 'function'
  ) {
    return candidate as NarrationChannel;
  }
  return null;
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

function sameSettings(a: SettingsSurface | null, b: SettingsSurface | null): boolean {
  if (a === null || b === null) return a === b;
  return a.selected === b.selected && a.capture === b.capture;
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
  let pendingSettingsToggles = 0;
  let pendingCaptured: string[] = [];
  let lastMoveY = 0;
  /** After a capture ends, ignore interact edges until the key is released,
   * so a freshly bound interact key does not immediately re-activate the
   * row it was bound from. */
  let interactCooldown = false;
  let unsubscribes: (() => void)[] = [];
  let stateEntity: EntityId | null = null;
  let captureEntity: EntityId | null = null;

  const reset = () => {
    pendingDialogue = [];
    pendingHints = [];
    pendingInteracts = 0;
    pendingSettingsToggles = 0;
    pendingCaptured = [];
    lastMoveY = 0;
    interactCooldown = false;
    stateEntity = null;
    captureEntity = null;
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
    // step and the accessibility settings applied this step. A world
    // without either still shows prompts and dialogue (FR-ARCH-008).
    dependencies: ['input', 'accessibility'],
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
      // The capture-request slice the Input System reads (docs/34): owned
      // here because this surface is what listens for a key.
      captureEntity = context.world.query(INPUT_CAPTURE)[0] ?? null;
      if (captureEntity === null) {
        captureEntity = context.world.createEntity();
        context.world.addComponent(captureEntity, INPUT_CAPTURE, { active: false });
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
      unsubscribes.push(
        context.events.subscribe(INTENT_SETTINGS, () => {
          pendingSettingsToggles += 1;
        }),
      );
      unsubscribes.push(
        context.events.subscribe(INPUT_KEY_CAPTURED, (event) => {
          if (typeof event.payload.code === 'string' && event.payload.code !== '') {
            pendingCaptured.push(event.payload.code);
          }
        }),
      );
    },
    update(_dt: number, context: SystemContext): void {
      if (stateEntity === null) return;
      const world = context.world;
      const state = world.getComponent(stateEntity, UI_STATE) ?? IDLE_UI_STATE;
      const strings = stringsOf(world);
      /** Lines to announce through the narration channel, in order. */
      const announcements: string[] = [];
      const announceKey = (key: string): void => {
        const text = strings[key];
        if (text !== undefined) announcements.push(text);
      };
      /** One settings row spoken as "label: value" from resolved strings. */
      const announceRow = (row: SettingsRow, value: string | undefined): void => {
        const label = strings[row.labelKey];
        if (label === undefined) return;
        announcements.push(value === undefined || value === '' ? label : `${label}: ${value}`);
      };
      const toggleText = (enabled: boolean): string | undefined =>
        strings[enabled ? UI_SETTINGS_ON_KEY : UI_SETTINGS_OFF_KEY];
      const rowValue = (row: SettingsRow): string | undefined => {
        if (row.kind === 'toggle') return toggleText(accessibilitySettingsOf(world)[row.setting]);
        if (row.kind === 'locale') return activeLocaleOf(world);
        return (activeBindings(world)[row.action] ?? []).join(' ');
      };

      let dialogue = state.dialogue;
      let settings = state.settings;
      let hint = state.hint;

      // The intent slice, read (never written) for selection edges and
      // activation; a surface never blocks walking (FR-UI-003).
      const intent = (() => {
        for (const entity of world.query(INPUT_INTENT)) {
          const value = world.getComponent(entity, INPUT_INTENT);
          if (value !== undefined) return value;
        }
        return null;
      })();
      // Clear the post-rebind cooldown only on an observed release — and
      // before this tick's capture completion can arm it, so a cooldown
      // always survives into the next tick.
      if (interactCooldown && intent?.interact !== true) interactCooldown = false;

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

      // The settings surface toggles on the settings intent (docs/34):
      // opening lands on the first row; closing abandons any capture.
      for (let i = 0; i < pendingSettingsToggles; i += 1) {
        if (settings === null) {
          settings = { selected: 0, capture: null };
          announceKey(UI_SETTINGS_TITLE_KEY);
          const first = SETTINGS_ROWS[0];
          if (first !== undefined) announceRow(first, rowValue(first));
        } else {
          settings = null;
        }
      }
      pendingSettingsToggles = 0;

      // A captured key completes (or, when it is the settings key, cancels)
      // the pending rebind: the surface only requests the write by event —
      // the Accessibility System owns the bindings slice (FR-ARCH-015).
      if (pendingCaptured.length > 0) {
        const code = pendingCaptured[0];
        if (settings !== null && settings.capture !== null && code !== undefined) {
          const settingsCodes = activeBindings(world)['settings'] ?? [];
          const row = SETTINGS_ROWS.find(
            (candidate) => candidate.kind === 'remap' && candidate.action === settings?.capture,
          );
          if (!settingsCodes.includes(code)) {
            context.events.publish(INPUT_REMAP, { action: settings.capture, codes: [code] });
            if (row !== undefined) announceRow(row, code);
          }
          settings = { ...settings, capture: null };
          interactCooldown = true;
        }
        pendingCaptured = [];
      }

      // Selection: vertical move-intent edges cycle the open surface's
      // selection — the settings surface first, the dialogue otherwise.
      const moveY = Math.sign(intent?.moveY ?? 0);
      if (moveY !== 0 && lastMoveY === 0) {
        if (settings !== null && settings.capture === null) {
          const count = SETTINGS_ROWS.length;
          settings = { ...settings, selected: (settings.selected + moveY + count) % count };
          const row = SETTINGS_ROWS[settings.selected];
          if (row !== undefined) announceRow(row, rowValue(row));
        } else if (settings === null && dialogue !== null && dialogue.choiceKeys.length > 0) {
          const count = dialogue.choiceKeys.length;
          dialogue = { ...dialogue, selected: (dialogue.selected + moveY + count) % count };
          announceKey(dialogue.choiceKeys[dialogue.selected] ?? '');
        }
      }
      lastMoveY = moveY;

      // Interact activates the open surface: a settings row (toggle or
      // rebind listen), else the dialogue (announce the choice and close).
      // Interacts with no surface open belong to the world; this System
      // ignores them (never steals gameplay input).
      if (pendingInteracts > 0 && !interactCooldown) {
        if (settings !== null) {
          if (settings.capture === null) {
            const row = SETTINGS_ROWS[settings.selected];
            if (row?.kind === 'toggle') {
              const flipped = !accessibilitySettingsOf(world)[row.setting];
              context.events.publish(
                ACCESSIBILITY_CONTROL,
                row.setting === 'reducedMotion'
                  ? { reducedMotion: flipped }
                  : { narration: flipped },
              );
              announceRow(row, toggleText(flipped));
            } else if (row?.kind === 'locale') {
              // Cycle the pack's shipped locales (issue #38); the Locale
              // System applies the switch — requested only by event.
              const locales = availableLocales(world);
              const index = locales.indexOf(activeLocaleOf(world));
              const next = locales[(index + 1) % Math.max(1, locales.length)];
              if (next !== undefined) {
                context.events.publish(LOCALE_SELECT, { locale: next });
                announceRow(row, next);
              }
            } else if (row?.kind === 'remap') {
              settings = { ...settings, capture: row.action };
              announceKey(UI_SETTINGS_REBIND_KEY);
            }
          }
        } else if (dialogue !== null) {
          const hasChoices = dialogue.choiceKeys.length > 0;
          context.events.publish(UI_DIALOGUE_CHOSEN, {
            textKey: dialogue.textKey,
            choiceKey: hasChoices ? (dialogue.choiceKeys[dialogue.selected] ?? null) : null,
            choiceIndex: hasChoices ? dialogue.selected : null,
          });
          dialogue = null;
        }
      }
      pendingInteracts = 0;

      // The capture request the Input System reads next step (docs/34):
      // active exactly while a remap row is listening.
      if (captureEntity !== null) {
        const wantCapture = settings !== null && settings.capture !== null;
        if ((world.getComponent(captureEntity, INPUT_CAPTURE)?.active ?? false) !== wantCapture) {
          world.addComponent(captureEntity, INPUT_CAPTURE, { active: wantCapture });
        }
      }

      // The proximity prompt appears beside reachable markers and hides
      // while a modal surface is open (AC1: appear/disappear correctly).
      const prompt =
        dialogue === null && settings === null && nearInteractable(world)
          ? UI_PROMPT_INTERACT_KEY
          : null;

      const next: UiState = {
        prompt,
        hint,
        dialogue,
        settings,
        modal: dialogue !== null || settings !== null,
      };

      // Narration of essential content (NFR-VIS-003): announce what just
      // surfaced — a new dialogue line, a hint, the interact prompt —
      // through the platform channel. Surface-interaction announcements
      // were queued above as they happened; all are gated together here.
      if (next.dialogue !== null && next.dialogue.textKey !== state.dialogue?.textKey) {
        announceKey(next.dialogue.textKey);
        const selectedChoice = next.dialogue.choiceKeys[next.dialogue.selected];
        if (selectedChoice !== undefined) announceKey(selectedChoice);
      }
      if (next.hint !== null && next.hint !== state.hint) announceKey(next.hint);
      if (next.prompt !== null && state.prompt === null) announceKey(next.prompt);
      const narration = narrationOf(context.platform);
      if (narration !== null && accessibilitySettingsOf(world).narration) {
        for (const line of announcements) narration.announce(line);
      }

      if (
        next.prompt !== state.prompt ||
        next.hint !== state.hint ||
        next.modal !== state.modal ||
        !sameDialogue(next.dialogue, state.dialogue) ||
        !sameSettings(next.settings, state.settings)
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

/** Estimated glyph advance for the system face, in px per character. */
const CHAR_WIDTH_FACTOR = 0.62;

/**
 * Clip one line of text to a pixel budget (DATA-FR-026): no layout may
 * assume string length, so an overlong localized string truncates with an
 * ellipsis instead of escaping its panel. The estimate matches the prompt
 * pill's sizing heuristic; measured wrapping stays an open question
 * (docs/35, OQ-UI-2).
 */
export function fitText(text: string, fontPx: number, maxWidth: number): string {
  const budget = Math.max(1, Math.floor(maxWidth / (fontPx * CHAR_WIDTH_FACTOR)));
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(1, budget - 1))}…`;
}

/**
 * Draw one presentation frame of UI above the world: the hint line (top
 * center), the interaction prompt (bottom center pill), and the dialogue
 * or settings surface (bottom panel). Pure with respect to world state —
 * it only reads the UI slice, the strings table, the accessibility
 * settings, and the bindings table, so presentation cadence cannot perturb
 * simulation (FR-ARCH-025). Text is resolved from locale keys; an
 * unresolved key draws nothing, never a raw key and never a fault
 * (FR-ARCH-008, DATA-FR-011).
 */
export function uiFrame(context: SystemContext, render: RenderSurface): void {
  const world = context.world;
  const state =
    world
      .query(UI_STATE)
      .map((entity) => world.getComponent(entity, UI_STATE))
      .find((value) => value !== undefined) ?? IDLE_UI_STATE;
  if (
    state.prompt === null &&
    state.hint === null &&
    state.dialogue === null &&
    state.settings === null
  ) {
    return;
  }

  const strings = stringsOf(world);
  const surface = render.size();
  const { fontPx, pad, panelWidth } = uiLayout(surface);
  const centerX = surface.width / 2;
  const lineHeight = Math.round(fontPx * 1.5);

  if (state.hint !== null) {
    const text = strings[state.hint];
    if (text !== undefined) {
      render.drawText(fitText(text, fontPx, surface.width - 2 * pad), centerX, pad, {
        color: CHOICE_COLOR,
        sizePx: fontPx,
        align: 'center',
      });
    }
  }

  if (state.settings !== null) {
    // The settings surface (docs/34): title plus one line per row, the
    // selection accented. Values are world state — toggle states through
    // the on/off locale keys, bindings as their physical key codes (
    // hardware identifiers, not career text). A listening row shows the
    // rebind prompt instead of its codes.
    const lines = 1 + SETTINGS_ROWS.length;
    const panelHeight = lines * lineHeight + 2 * pad;
    const left = centerX - panelWidth / 2;
    const top = surface.height - panelHeight - pad;
    render.fillRect(left, top, panelWidth, panelHeight, PANEL_COLOR);
    render.drawLine(left, top, left + panelWidth, top, PANEL_EDGE_COLOR);
    let y = top + pad;
    const title = strings[UI_SETTINGS_TITLE_KEY];
    if (title !== undefined) {
      render.drawText(fitText(title, fontPx, panelWidth - 2 * pad), left + pad, y, {
        color: TEXT_COLOR,
        sizePx: fontPx,
      });
    }
    y += lineHeight;
    const settingsValues = accessibilitySettingsOf(world);
    const bindings = activeBindings(world);
    SETTINGS_ROWS.forEach((row, index) => {
      const label = strings[row.labelKey];
      const capturing = state.settings?.capture !== null && index === state.settings?.selected;
      const value =
        row.kind === 'toggle'
          ? strings[settingsValues[row.setting] ? UI_SETTINGS_ON_KEY : UI_SETTINGS_OFF_KEY]
          : row.kind === 'locale'
            ? activeLocaleOf(world)
            : capturing
              ? strings[UI_SETTINGS_REBIND_KEY]
              : (bindings[row.action] ?? []).join(' ');
      if (label !== undefined) {
        const selected = index === state.settings?.selected;
        const text = value === undefined || value === '' ? label : `${label}  ${value}`;
        render.drawText(fitText(text, fontPx, panelWidth - 3 * pad), left + pad * 2, y, {
          color: selected ? CHOICE_SELECTED_COLOR : CHOICE_COLOR,
          sizePx: fontPx,
        });
      }
      y += lineHeight;
    });
    return; // The settings panel replaces the dialogue and prompt while open.
  }

  if (state.dialogue !== null) {
    const text = strings[state.dialogue.textKey];
    const choices = state.dialogue.choiceKeys.map((key) => strings[key]);
    const lines = 1 + choices.filter((choice) => choice !== undefined).length;
    const panelHeight = lines * lineHeight + 2 * pad;
    const left = centerX - panelWidth / 2;
    const top = surface.height - panelHeight - pad;
    render.fillRect(left, top, panelWidth, panelHeight, PANEL_COLOR);
    render.drawLine(left, top, left + panelWidth, top, PANEL_EDGE_COLOR);
    let y = top + pad;
    if (text !== undefined) {
      render.drawText(fitText(text, fontPx, panelWidth - 2 * pad), left + pad, y, {
        color: TEXT_COLOR,
        sizePx: fontPx,
      });
    }
    y += lineHeight;
    choices.forEach((choice, index) => {
      if (choice === undefined) return;
      const selected = index === state.dialogue?.selected;
      render.drawText(fitText(choice, fontPx, panelWidth - 3 * pad), left + pad * 2, y, {
        color: selected ? CHOICE_SELECTED_COLOR : CHOICE_COLOR,
        sizePx: fontPx,
      });
      y += lineHeight;
    });
    return; // The dialogue panel replaces the prompt pill (modal surface).
  }

  if (state.prompt !== null) {
    const raw = strings[state.prompt];
    if (raw !== undefined) {
      const text = fitText(raw, fontPx, panelWidth - 2 * pad);
      const pillHeight = fontPx + 2 * pad;
      const pillWidth = Math.min(
        panelWidth,
        Math.max(120, text.length * fontPx * CHAR_WIDTH_FACTOR),
      );
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
