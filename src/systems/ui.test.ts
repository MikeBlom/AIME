/**
 * UI / HUD System suite (issue #23): the proximity prompt appears and
 * disappears correctly and never blocks movement (AC1), the layout stays
 * legible on desktop and small mobile viewports with every string resolved
 * from locale keys — never inline (AC2) — and the dialogue surface is a
 * pure event-driven API other Systems reach without references.
 */
import { describe, expect, it } from 'vitest';
import type { EntityId, SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import { createHeadlessPlatform } from '../platform';
import { INPUT_INTENT, INTENT_INTERACT } from './input';
import type { InputIntent } from './input';
import { movementSystem } from './movement';
import { IDLE_MOTION, MOTION, PLAYER_CONTROLLED, POSITION, RENDERABLE } from './scene';
import {
  createUiSystem,
  LOCALE_STRINGS,
  PROMPT_RADIUS,
  UI_DIALOGUE_CHOSEN,
  UI_DIALOGUE_CLOSE,
  UI_DIALOGUE_OPEN,
  UI_HINT,
  UI_PROMPT_INTERACT_KEY,
  UI_STATE,
  uiFrame,
  uiLayout,
} from './ui';

const DT = 1 / 60;

interface Harness {
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly context: SystemContext;
  readonly system: ReturnType<typeof createUiSystem>;
  /** One simulated fixed step: flush deferred events, then update. */
  step(): void;
}

function harness(): Harness {
  const world = new EntityStore();
  const events = new EventBus({ logEnabled: false });
  const context: SystemContext = {
    world,
    events,
    scheduler: { schedule: (task: () => void) => task() },
    platform: createHeadlessPlatform(),
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const system = createUiSystem();
  system.init(context);
  return {
    world,
    events,
    context,
    system,
    step: () => {
      events.flushDeferred();
      system.update(DT, context);
    },
  };
}

function uiState(h: Harness) {
  const entity = h.world.query(UI_STATE)[0];
  return entity === undefined ? undefined : h.world.getComponent(entity, UI_STATE);
}

function addStrings(world: EntityStore, entries: Record<string, string>): void {
  const entity = world.createEntity();
  world.addComponent(entity, LOCALE_STRINGS, { entries });
}

function addPlayer(world: EntityStore, x: number, y: number): EntityId {
  const entity = world.createEntity();
  world.addComponent(entity, POSITION, { x, y });
  world.addComponent(entity, PLAYER_CONTROLLED, { speed: 96 });
  world.addComponent(entity, MOTION, IDLE_MOTION);
  return entity;
}

function addMarker(world: EntityStore, kind: string, x: number, y: number): EntityId {
  const entity = world.createEntity();
  world.addComponent(entity, POSITION, { x, y });
  world.addComponent(entity, RENDERABLE, { kind, width: 8, height: 12 });
  return entity;
}

function setIntent(world: EntityStore, intent: InputIntent): void {
  const existing = world.query(INPUT_INTENT)[0];
  const entity = existing ?? world.createEntity();
  world.addComponent(entity, INPUT_INTENT, intent);
}

const IDLE_INTENT: InputIntent = { moveX: 0, moveY: 0, toX: null, toY: null, interact: false };

describe('interaction prompt (AC1: appears/disappears correctly)', () => {
  it('appears within reach of an npc/building marker and hides out of reach', () => {
    const h = harness();
    const player = addPlayer(h.world, 100, 100);
    addMarker(h.world, 'npc', 100 + PROMPT_RADIUS - 1, 100);
    h.step();
    expect(uiState(h)?.prompt).toBe(UI_PROMPT_INTERACT_KEY);

    h.world.addComponent(player, POSITION, { x: 100 - PROMPT_RADIUS, y: 100 - PROMPT_RADIUS });
    h.step();
    expect(uiState(h)?.prompt).toBeNull();
  });

  it('a non-prompting kind raises no prompt; no player means no prompt', () => {
    const h = harness();
    addMarker(h.world, 'player', 100, 100);
    addMarker(h.world, 'npc', 100, 100);
    h.step();
    expect(uiState(h)?.prompt).toBeNull();
  });

  it('never blocks movement: the intent slice is untouched and movement still runs', () => {
    const h = harness();
    const player = addPlayer(h.world, 100, 100);
    addMarker(h.world, 'npc', 110, 100);
    const intent: InputIntent = { moveX: 1, moveY: 0, toX: null, toY: null, interact: false };
    setIntent(h.world, intent);
    h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line' });
    h.step();
    expect(uiState(h)?.modal).toBe(true);

    // The UI System never writes the intent slice...
    const slice = h.world.getComponent(h.world.query(INPUT_INTENT)[0] as EntityId, INPUT_INTENT);
    expect(slice).toBe(intent);
    // ...so the movement System still moves the player while the dialogue
    // is open (prompts/dialogue never block movement, AC1).
    const before = h.world.getComponent(player, POSITION)?.x ?? 0;
    movementSystem.update(DT, h.context);
    expect(h.world.getComponent(player, POSITION)?.x ?? 0).toBeGreaterThan(before);
  });
});

describe('dialogue surface API (interface contract)', () => {
  it('opens on the open event, closes on interact, and announces the choice', () => {
    const h = harness();
    addPlayer(h.world, 100, 100);
    const chosen: unknown[] = [];
    h.events.subscribe(UI_DIALOGUE_CHOSEN, (event) => chosen.push(event.payload));

    h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line', choiceKeys: ['k.a', 'k.b'] });
    h.step();
    expect(uiState(h)?.dialogue).toEqual({
      textKey: 'k.line',
      choiceKeys: ['k.a', 'k.b'],
      selected: 0,
    });
    expect(uiState(h)?.modal).toBe(true);

    h.events.publish(INTENT_INTERACT, {});
    h.step();
    h.events.flushDeferred(); // deliver the deferred UI_DIALOGUE_CHOSEN
    expect(uiState(h)?.dialogue).toBeNull();
    expect(uiState(h)?.modal).toBe(false);
    expect(chosen).toEqual([{ textKey: 'k.line', choiceKey: 'k.a', choiceIndex: 0 }]);
  });

  it('vertical move-intent edges cycle the selection without repeating while held', () => {
    const h = harness();
    addPlayer(h.world, 100, 100);
    h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line', choiceKeys: ['k.a', 'k.b', 'k.c'] });
    h.step();

    setIntent(h.world, { ...IDLE_INTENT, moveY: 1 });
    h.step();
    expect(uiState(h)?.dialogue?.selected).toBe(1);
    h.step(); // held: no repeat
    expect(uiState(h)?.dialogue?.selected).toBe(1);

    setIntent(h.world, IDLE_INTENT);
    h.step();
    setIntent(h.world, { ...IDLE_INTENT, moveY: -1 });
    h.step();
    expect(uiState(h)?.dialogue?.selected).toBe(0);
  });

  it('closes on the close event and ignores malformed open payloads', () => {
    const h = harness();
    h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line' });
    h.step();
    expect(uiState(h)?.dialogue?.textKey).toBe('k.line');

    h.events.publish(UI_DIALOGUE_CLOSE, {});
    h.step();
    expect(uiState(h)?.dialogue).toBeNull();

    h.events.publish(UI_DIALOGUE_OPEN, { textKey: '' });
    expect(() => h.step()).not.toThrow();
    expect(uiState(h)?.dialogue).toBeNull();
  });

  it('interact with no dialogue open changes nothing (input belongs to the world)', () => {
    const h = harness();
    addPlayer(h.world, 100, 100);
    h.events.publish(INTENT_INTERACT, {});
    h.step();
    expect(uiState(h)).toEqual({ prompt: null, hint: null, dialogue: null, modal: false });
  });

  it('shows and clears the hint line via events', () => {
    const h = harness();
    h.events.publish(UI_HINT, { textKey: 'k.hint' });
    h.step();
    expect(uiState(h)?.hint).toBe('k.hint');
    h.events.publish(UI_HINT, { textKey: null });
    h.step();
    expect(uiState(h)?.hint).toBeNull();
  });
});

describe('presentation (AC2: legible on desktop and mobile, no inline strings)', () => {
  it('draws prompt text resolved from the locale strings table, centered on screen', () => {
    const h = harness();
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    addStrings(h.world, { [UI_PROMPT_INTERACT_KEY]: 'LOCALIZED interact' });
    addPlayer(h.world, 100, 100);
    addMarker(h.world, 'npc', 105, 100);
    h.step();

    uiFrame(h.context, platform.render);
    const texts = platform.render.commands.filter((c) => c['op'] === 'drawText');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'LOCALIZED interact', x: 320, align: 'center' });
  });

  it('an unresolved locale key draws nothing — never the raw key (DATA-FR-011)', () => {
    const h = harness();
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    addPlayer(h.world, 100, 100);
    addMarker(h.world, 'npc', 105, 100);
    h.step();

    uiFrame(h.context, platform.render);
    expect(platform.render.commands.filter((c) => c['op'] === 'drawText')).toEqual([]);
  });

  it('draws the dialogue panel with line and choices, highlighting the selection', () => {
    const h = harness();
    const platform = createHeadlessPlatform({ width: 640, height: 360 });
    addStrings(h.world, { 'k.line': 'LOCALIZED line', 'k.a': 'LOCALIZED a', 'k.b': 'LOCALIZED b' });
    h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line', choiceKeys: ['k.a', 'k.b'] });
    h.step();

    uiFrame(h.context, platform.render);
    const panel = platform.render.commands.filter((c) => c['op'] === 'fillRect');
    expect(panel).toHaveLength(1);
    const texts = platform.render.commands.filter((c) => c['op'] === 'drawText');
    expect(texts.map((t) => t['text'])).toEqual(['LOCALIZED line', 'LOCALIZED a', 'LOCALIZED b']);
    const [, choiceA, choiceB] = texts;
    expect(choiceA?.['color']).not.toBe(choiceB?.['color']); // selection highlighted
  });

  it('stays legible on a small mobile viewport: readable font, panel inside bounds', () => {
    for (const surface of [
      { width: 640, height: 360 },
      { width: 180, height: 320 },
    ]) {
      const layout = uiLayout(surface);
      expect(layout.fontPx).toBeGreaterThanOrEqual(11);
      expect(layout.fontPx).toBeLessThanOrEqual(22);
      expect(layout.panelWidth).toBeLessThanOrEqual(surface.width);

      const h = harness();
      const platform = createHeadlessPlatform(surface);
      addStrings(h.world, { 'k.line': 'LOCALIZED line' });
      h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line' });
      h.step();
      uiFrame(h.context, platform.render);
      const panel = platform.render.commands.find((c) => c['op'] === 'fillRect');
      expect(panel).toBeDefined();
      const left = panel?.['x'] as number;
      const width = panel?.['width'] as number;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(surface.width);
    }
  });

  it('draws nothing at all while the UI is idle', () => {
    const h = harness();
    const platform = createHeadlessPlatform();
    h.step();
    uiFrame(h.context, platform.render);
    expect(platform.render.commands).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('unsubscribes on teardown: later events no longer reach the slice', () => {
    const h = harness();
    h.system.teardown(h.context);
    h.events.publish(UI_DIALOGUE_OPEN, { textKey: 'k.line' });
    h.events.flushDeferred();
    h.system.update(DT, h.context);
    expect(uiState(h)?.dialogue).toBeNull();
  });

  it('re-init adopts the existing UI slice instead of spawning a second one', () => {
    const h = harness();
    h.system.teardown(h.context);
    h.system.init(h.context);
    expect(h.world.query(UI_STATE)).toHaveLength(1);
  });
});
