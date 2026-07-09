/**
 * Locale System — the locale service resolving player-visible text
 * (issue #38; spec: docs/35-Localization.md).
 *
 * Content lands two things at spawn: LOCALE_TABLES (every locale's keyed
 * strings plus the pack's default locale, DATA-FR-024) and LOCALE_STRINGS
 * (the resolved table every consumer reads, DATA-FR-011). This System owns
 * both LOCALE_STATE (the active locale) and the resolved table: whenever
 * the active locale changes — a `locale.select` event, or a restored save
 * landing a different choice — it rebuilds LOCALE_STRINGS as the default
 * table overlaid with the active locale's entries, so a key the active
 * locale does not define falls back to the default text per key, never to
 * a blank or a raw key (DATA-FR-025).
 *
 * Consumers stay unchanged: UI and dialogue resolve keys through
 * LOCALE_STRINGS exactly as before; which words appear is this System's
 * business, requested only by event (FR-ARCH-005). Determinism
 * (NFR-ARCH-001): update reads only world state and buffered events.
 */
import type { EntityId, EntityStore, Plugin, System, SystemContext } from '../core';
import { defineComponentType, defineEventType } from '../core';

/**
 * The pack's resolved strings table (locale key → localized text) every
 * player-visible surface reads (DATA-FR-011). Seeded at spawn with the
 * default locale; rewritten by this System when the active locale changes.
 */
export type LocaleStrings = { readonly entries: { readonly [key: string]: string } };
export const LOCALE_STRINGS = defineComponentType<LocaleStrings>('locale-strings');

/**
 * Every locale the pack ships, keyed identically to the default locale
 * (DATA-FR-024), landed at spawn like the asset manifest. Data only —
 * resolution behavior lives in this System.
 */
export type LocaleTables = {
  readonly defaultLocale: string;
  readonly locales: { readonly [locale: string]: { readonly [key: string]: string } };
};
export const LOCALE_TABLES = defineComponentType<LocaleTables>('locale-tables');

/** The active-locale slice, owned by this System (FR-ARCH-015). */
export type LocaleState = { readonly active: string };
export const LOCALE_STATE = defineComponentType<LocaleState>('locale-state');

/**
 * Request a locale switch. A locale the pack does not ship is ignored
 * without faulting (FR-ARCH-008); the switch applies on the next update.
 */
export const LOCALE_SELECT = defineEventType<{ readonly locale: string }>('locale.select');

/** The engine's last-resort locale tag when a world carries no tables. */
const FALLBACK_LOCALE = 'en';

function tablesOf(world: EntityStore): LocaleTables | null {
  for (const entity of world.query(LOCALE_TABLES)) {
    const tables = world.getComponent(entity, LOCALE_TABLES);
    if (tables !== undefined) return tables;
  }
  return null;
}

/** The locales the world's pack ships, sorted for stable cycling order. */
export function availableLocales(world: EntityStore): readonly string[] {
  const tables = tablesOf(world);
  if (tables === null) return [];
  return Object.keys(tables.locales).sort();
}

/** The active locale by query, defaulting through tables to the engine tag. */
export function activeLocaleOf(world: EntityStore): string {
  for (const entity of world.query(LOCALE_STATE)) {
    const state = world.getComponent(entity, LOCALE_STATE);
    if (state !== undefined) return state.active;
  }
  return tablesOf(world)?.defaultLocale ?? FALLBACK_LOCALE;
}

/**
 * Resolve one locale against the default: the default table is the key
 * set's source of truth, and the active locale overrides per key — the
 * fallback DATA-FR-025 requires, applied wholesale.
 */
export function resolveLocaleEntries(
  tables: LocaleTables,
  active: string,
): { readonly [key: string]: string } {
  const defaults = tables.locales[tables.defaultLocale] ?? {};
  const overlay = active === tables.defaultLocale ? {} : (tables.locales[active] ?? {});
  return { ...defaults, ...overlay };
}

/**
 * Build the Locale System. A factory (not a shared instance) because the
 * System buffers select events and caches the locale it last resolved;
 * each booted world gets its own instance.
 */
export function createLocaleSystem(): System {
  let pendingSelects: string[] = [];
  let unsubscribe: (() => void) | null = null;
  let stateEntity: EntityId | null = null;
  /** The locale LOCALE_STRINGS currently reflects (applied-state cache). */
  let resolvedFor: string | null = null;

  const reset = () => {
    pendingSelects = [];
    stateEntity = null;
    resolvedFor = null;
  };

  return {
    id: 'locale',
    dependencies: [],
    init(context: SystemContext): void {
      reset();
      const world = context.world;
      // The active-locale slice: adopt (hot re-init or restored save) or
      // spawn at the pack's default. Sole writer (FR-ARCH-015).
      const existing = world.query(LOCALE_STATE)[0];
      if (existing === undefined) {
        stateEntity = world.createEntity();
        world.addComponent(stateEntity, LOCALE_STATE, {
          active: tablesOf(world)?.defaultLocale ?? FALLBACK_LOCALE,
        });
      } else {
        stateEntity = existing;
      }
      // Spawn seeded LOCALE_STRINGS with the default locale, so that is
      // what the world currently shows.
      resolvedFor = tablesOf(world)?.defaultLocale ?? null;
      unsubscribe = context.events.subscribe(LOCALE_SELECT, (event) => {
        // Defensive: a malformed payload is dropped, never a fault
        // (FR-ARCH-008, FR-L10N-004).
        const payload: unknown = event.payload;
        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return;
        const locale = (payload as { readonly locale?: unknown }).locale;
        if (typeof locale === 'string' && locale !== '') pendingSelects.push(locale);
      });
    },
    update(_dt: number, context: SystemContext): void {
      if (stateEntity === null) return;
      const world = context.world;
      const tables = tablesOf(world);

      let state = world.getComponent(stateEntity, LOCALE_STATE);
      if (state === undefined || tables === null) {
        pendingSelects = [];
        return;
      }
      for (const locale of pendingSelects) {
        // Only shipped locales apply (FR-ARCH-008); order is arrival order.
        if (tables.locales[locale] !== undefined && locale !== state.active) {
          state = { active: locale };
        }
      }
      pendingSelects = [];
      if (state !== world.getComponent(stateEntity, LOCALE_STATE)) {
        world.addComponent(stateEntity, LOCALE_STATE, state);
      }

      // Re-resolve whenever the active locale and the resolved table
      // disagree — covering select events and a restored save alike.
      if (state.active !== resolvedFor) {
        const entries = resolveLocaleEntries(tables, state.active);
        const holder = world.query(LOCALE_STRINGS)[0] ?? world.createEntity();
        world.addComponent(holder, LOCALE_STRINGS, { entries });
        resolvedFor = state.active;
      }
    },
    teardown(): void {
      unsubscribe?.();
      unsubscribe = null;
      reset();
    },
  };
}

/**
 * The locale plugin: the System plus the component and event types it
 * introduces, registered and removed as one unit (FR-ARCH-018). A factory
 * so every world composes a fresh System instance. LOCALE_STRINGS itself
 * is registered by the UI plugin, its longest-standing consumer.
 */
export function createLocalePlugin(): Plugin {
  return {
    id: 'plugin.locale',
    systems: [createLocaleSystem()],
    componentTypes: [LOCALE_TABLES, LOCALE_STATE],
    eventTypes: [LOCALE_SELECT],
  };
}
