/**
 * Locale System suite (issue #38; docs/35-Localization.md): the active
 * locale is owned state switched only by events (FR-L10N-002), resolution
 * overlays the active locale on the default so missing keys fall back per
 * key (FR-L10N-003, DATA-FR-025), unknown locales are ignored
 * (FR-L10N-004), and the choice survives a save round-trip (FR-L10N-006).
 */
import { describe, expect, it } from 'vitest';
import type { SystemContext } from '../core';
import { deepFreeze, EntityStore, EventBus, RngService, TimeService } from '../core';
import {
  activeLocaleOf,
  availableLocales,
  createLocaleSystem,
  LOCALE_SELECT,
  LOCALE_STRINGS,
  LOCALE_TABLES,
  resolveLocaleEntries,
} from './locale';
import type { LocaleTables } from './locale';
import { applySave, captureSave } from './saveload';

const DT = 1 / 60;

const TABLES: LocaleTables = {
  defaultLocale: 'en',
  locales: {
    en: { 'k.greeting': 'EN greeting', 'k.farewell': 'EN farewell' },
    xl: { 'k.greeting': 'XL greeting' }, // k.farewell missing: falls back
  },
};

interface Harness {
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly context: SystemContext;
  readonly system: ReturnType<typeof createLocaleSystem>;
  step(): void;
}

function harness(tables: LocaleTables | null = TABLES): Harness {
  const world = new EntityStore();
  const events = new EventBus({ logEnabled: false });
  if (tables !== null) {
    // Mirror spawn: tables plus the default-locale seed of the resolved table.
    world.addComponent(world.createEntity(), LOCALE_TABLES, tables);
    world.addComponent(world.createEntity(), LOCALE_STRINGS, {
      entries: tables.locales[tables.defaultLocale] ?? {},
    });
  }
  const context: SystemContext = {
    world,
    events,
    scheduler: { schedule: (task: () => void) => task() },
    platform: {},
    time: new TimeService(DT),
    rng: new RngService(1),
    input: { current: deepFreeze({}) },
  };
  const system = createLocaleSystem();
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

function resolved(h: Harness): { readonly [key: string]: string } {
  const entity = h.world.query(LOCALE_STRINGS)[0];
  return (
    (entity === undefined ? undefined : h.world.getComponent(entity, LOCALE_STRINGS)?.entries) ?? {}
  );
}

describe('locale state and selection', () => {
  it('spawns the active locale at the pack default and lists shipped locales sorted', () => {
    const h = harness();
    expect(activeLocaleOf(h.world)).toBe('en');
    expect(availableLocales(h.world)).toEqual(['en', 'xl']);
  });

  it('switching locale rewrites the resolved table every consumer reads (AC1)', () => {
    const h = harness();
    h.events.publish(LOCALE_SELECT, { locale: 'xl' });
    h.step();
    expect(activeLocaleOf(h.world)).toBe('xl');
    expect(resolved(h)['k.greeting']).toBe('XL greeting');

    h.events.publish(LOCALE_SELECT, { locale: 'en' });
    h.step();
    expect(resolved(h)).toEqual(TABLES.locales['en']);
  });

  it('a key the active locale lacks falls back to the default text (DATA-FR-025)', () => {
    const h = harness();
    h.events.publish(LOCALE_SELECT, { locale: 'xl' });
    h.step();
    expect(resolved(h)['k.farewell']).toBe('EN farewell'); // never blank, never a raw key
  });

  it('ignores unshipped locales and malformed payloads without faulting (FR-L10N-004)', () => {
    const h = harness();
    for (const payload of [{ locale: 'zz' }, { locale: '' }, { locale: 7 }, {}, null]) {
      h.events.publish(LOCALE_SELECT, payload as never);
      expect(() => h.step()).not.toThrow();
    }
    expect(activeLocaleOf(h.world)).toBe('en');
    expect(resolved(h)).toEqual(TABLES.locales['en']);
  });

  it('the last valid select in a tick wins (arrival order)', () => {
    const h = harness();
    h.events.publish(LOCALE_SELECT, { locale: 'xl' });
    h.events.publish(LOCALE_SELECT, { locale: 'zz' }); // invalid: ignored
    h.events.publish(LOCALE_SELECT, { locale: 'en' });
    h.step();
    expect(activeLocaleOf(h.world)).toBe('en');
  });

  it('a world with no tables leaves the seeded strings untouched (FR-ARCH-008)', () => {
    const h = harness(null);
    h.events.publish(LOCALE_SELECT, { locale: 'xl' });
    expect(() => h.step()).not.toThrow();
    expect(activeLocaleOf(h.world)).toBe('en'); // the engine fallback tag
  });
});

describe('pure resolution helper', () => {
  it('overlays the active locale on the default, per key', () => {
    expect(resolveLocaleEntries(TABLES, 'xl')).toEqual({
      'k.greeting': 'XL greeting',
      'k.farewell': 'EN farewell',
    });
    expect(resolveLocaleEntries(TABLES, 'en')).toEqual(TABLES.locales['en']);
    expect(resolveLocaleEntries(TABLES, 'zz')).toEqual(TABLES.locales['en']);
  });
});

describe('persistence (FR-L10N-006)', () => {
  it('the locale choice survives a save/load round-trip and re-resolves on update', () => {
    const before = harness();
    before.events.publish(LOCALE_SELECT, { locale: 'xl' });
    before.step();
    const envelope = captureSave(before.world, { id: 'pack.test', version: '1.0.0' });

    const after = harness();
    expect(applySave(after.world, envelope)).toBeGreaterThanOrEqual(1);
    // The restored choice and the resolved table disagree until the next
    // update, which re-resolves (the resume flow, FR-L10N-002).
    after.step();
    expect(activeLocaleOf(after.world)).toBe('xl');
    expect(resolved(after)['k.greeting']).toBe('XL greeting');
  });
});
