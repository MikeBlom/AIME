/**
 * Save/Load System — serializes progression world-state slices through the
 * platform storage adapter (issue #24; spec:
 * docs/32-Save-Load-and-Persistence.md).
 *
 * What persists is *only mutable world state*: a declared list of
 * progression component types captured as (entityId, value) pairs inside a
 * versioned envelope. The content graph — documents, strings, manifests —
 * is never serialized (it reloads from the pack); world spawn is
 * deterministic (DATA-FR-017), so a resumed session re-spawns from the
 * same pack and overlays the saved slice values onto the same entity ids
 * (FR-ARCH-016 round-trip).
 *
 * Loading is atomic and defensive: the envelope is validated structurally,
 * checked against the running pack's identity, migrated forward through
 * registered hooks, and applied only to whitelisted slices on entities
 * that exist — a corrupt, foreign, or future save is rejected whole and
 * the world simply starts fresh (FR-ARCH-030's spirit, FR-ARCH-008).
 *
 * The System itself only autosaves: it subscribes to key gameplay events
 * and captures a save on its next update. Explicit `saveWorld`/`loadWorld`
 * are pure functions the composition root (and tests) drive; no System
 * ever references another (FR-ARCH-005). Determinism (NFR-ARCH-001):
 * capture reads world state only; storage writes do not feed back into
 * simulation.
 */
import type {
  ComponentData,
  ComponentType,
  EntityId,
  EntityStore,
  EventPayload,
  EventType,
  Plugin,
  System,
  SystemContext,
} from '../core';
import { defineEventType } from '../core';
import type { KeyValueStorage } from '../platform';
import { ACHIEVEMENT_STATE } from './achievements';
import { AUDIO_SETTINGS } from './audio';
import { PROGRESSION } from './progression';
import { QUEST_STATE, SYSTEM_RESTORED } from './quest';
import { CAMERA } from './render';
import {
  ACTIVE_SPACE,
  MOTION,
  MOVEMENT_STOPPED,
  POSITION,
  REGION,
  REGION_ENTERED,
  SPACE,
} from './scene';

/** The envelope's format tag; a stored value without it is not a save. */
export const SAVE_FORMAT = 'world.save';

/** Current save format version; migrations lift older envelopes to this. */
export const SAVE_VERSION = 1;

/** Default storage key for the single v1 save slot. */
export const SAVE_SLOT_KEY = 'save.slot.default';

/**
 * The progression slices persisted by default: player/world position and
 * motion, region live state, the camera view, audio settings, and quest
 * progress. All mutable world state; no content, no presentation transients.
 */
export const PROGRESSION_SLICES: readonly ComponentType<ComponentData>[] = [
  POSITION,
  MOTION,
  REGION,
  CAMERA,
  AUDIO_SETTINGS,
  QUEST_STATE,
  // Which space each entity inhabits and the active-space slice (issue
  // #30), so a session saved inside a building resumes inside it.
  SPACE,
  ACTIVE_SPACE,
  // Restored systems, unlocked capabilities, and inventory (issue #31).
  PROGRESSION,
  // Achievement unlock state (issue #32).
  ACHIEVEMENT_STATE,
];

/** Gameplay events that trigger an autosave on the following update. */
export const AUTOSAVE_EVENTS: readonly EventType<EventPayload>[] = [
  REGION_ENTERED,
  MOVEMENT_STOPPED,
  SYSTEM_RESTORED,
];

/** A versioned, self-describing save of progression slices. */
export type SaveEnvelope = {
  readonly format: typeof SAVE_FORMAT;
  readonly version: number;
  readonly pack: { readonly id: string; readonly version: string };
  /** Component type id → (entity id, value) pairs, in query order. */
  readonly slices: { readonly [typeId: string]: readonly (readonly [number, ComponentData])[] };
};

/**
 * A forward migration hook: lifts an envelope from exactly `from` to
 * `from + 1`. Registered in order; a gap or a future version rejects the
 * save instead of guessing.
 */
export type SaveMigration = {
  readonly from: number;
  readonly migrate: (envelope: SaveEnvelope) => SaveEnvelope;
};

/** Announced (deferred) after a save is written; observability hook. */
export const WORLD_SAVED = defineEventType<{ readonly slot: string }>('save.written');

/** Announced (deferred) after a save is applied on resume. */
export const WORLD_RESTORED = defineEventType<{ readonly slot: string }>('save.restored');

/** Capture the declared progression slices into an envelope (pure). */
export function captureSave(
  world: EntityStore,
  pack: { readonly id: string; readonly version: string },
  slices: readonly ComponentType<ComponentData>[] = PROGRESSION_SLICES,
): SaveEnvelope {
  const captured: Record<string, (readonly [number, ComponentData])[]> = {};
  for (const type of slices) {
    const rows: (readonly [number, ComponentData])[] = [];
    for (const entity of world.query(type)) {
      const value = world.getComponent(entity, type);
      if (value !== undefined) rows.push([entity, value]);
    }
    captured[type.id] = rows;
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    pack: { id: pack.id, version: pack.version },
    slices: captured,
  };
}

/** Strict structural validation; anything off rejects the whole envelope. */
export function parseSave(serialized: string): SaveEnvelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as { readonly [key: string]: unknown };
  if (record['format'] !== SAVE_FORMAT) return null;
  const version = record['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  const pack = record['pack'];
  if (typeof pack !== 'object' || pack === null || Array.isArray(pack)) return null;
  const packRecord = pack as { readonly [key: string]: unknown };
  if (typeof packRecord['id'] !== 'string' || typeof packRecord['version'] !== 'string') {
    return null;
  }
  const slices = record['slices'];
  if (typeof slices !== 'object' || slices === null || Array.isArray(slices)) return null;
  for (const rows of Object.values(slices as { readonly [key: string]: unknown })) {
    if (!Array.isArray(rows)) return null;
    for (const row of rows as readonly unknown[]) {
      if (!Array.isArray(row) || row.length !== 2) return null;
      if (typeof row[0] !== 'number' || !Number.isInteger(row[0]) || row[0] < 1) return null;
      if (row[1] === undefined || typeof row[1] === 'function') return null;
    }
  }
  return raw as SaveEnvelope;
}

/**
 * Lift an older envelope to the current version through the registered
 * hooks. Returns null when no unbroken migration path exists — including
 * a save from a *newer* engine, which is never guessed at.
 */
export function migrateSave(
  envelope: SaveEnvelope,
  migrations: readonly SaveMigration[] = [],
): SaveEnvelope | null {
  let current = envelope;
  while (current.version < SAVE_VERSION) {
    const hop = migrations.find((m) => m.from === current.version);
    if (hop === undefined) return null;
    const next = hop.migrate(current);
    if (next.version !== current.version + 1) return null;
    current = next;
  }
  return current.version === SAVE_VERSION ? current : null;
}

/**
 * Overlay a validated envelope onto a freshly spawned world: for each
 * whitelisted slice, replace the value on every saved entity id that
 * exists. Unknown slice ids and vanished entities are skipped, never
 * faults. Returns the number of component values applied.
 */
export function applySave(
  world: EntityStore,
  envelope: SaveEnvelope,
  slices: readonly ComponentType<ComponentData>[] = PROGRESSION_SLICES,
): number {
  const byId = new Map(slices.map((type) => [type.id, type]));
  let applied = 0;
  for (const [typeId, rows] of Object.entries(envelope.slices)) {
    const type = byId.get(typeId);
    if (type === undefined) continue; // not a whitelisted slice: ignored
    for (const [entity, value] of rows) {
      try {
        world.addComponent(entity as EntityId, type, value);
        applied += 1;
      } catch {
        // A vanished entity id (content changed shape): skip, never fault.
      }
    }
  }
  return applied;
}

/** Narrow the open platform record to a KeyValueStorage; null degrades. */
function storageOf(platform: SystemContext['platform']): KeyValueStorage | null {
  const candidate = (platform as { readonly storage?: unknown }).storage;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as KeyValueStorage).read === 'function' &&
    typeof (candidate as KeyValueStorage).write === 'function' &&
    typeof (candidate as KeyValueStorage).remove === 'function'
  ) {
    return candidate as KeyValueStorage;
  }
  return null;
}

export interface SaveLoadOptions {
  /** Pack identity stamped into (and required of) every envelope. */
  readonly pack: { readonly id: string; readonly version: string };
  readonly slices?: readonly ComponentType<ComponentData>[];
  readonly autosaveOn?: readonly EventType<EventPayload>[];
  readonly slotKey?: string;
  readonly migrations?: readonly SaveMigration[];
}

/** Serialize and write the current progression state; false when no storage. */
export function saveWorld(context: SystemContext, options: SaveLoadOptions): boolean {
  const storage = storageOf(context.platform);
  if (storage === null) return false;
  const envelope = captureSave(context.world, options.pack, options.slices ?? PROGRESSION_SLICES);
  storage.write(options.slotKey ?? SAVE_SLOT_KEY, JSON.stringify(envelope));
  return true;
}

/**
 * Safe resume: read, validate, pack-check, migrate, and apply the stored
 * save. Any failure leaves the freshly spawned world untouched and
 * returns false (the world starts fresh); a bad payload never faults.
 */
export function loadWorld(context: SystemContext, options: SaveLoadOptions): boolean {
  const storage = storageOf(context.platform);
  if (storage === null) return false;
  const serialized = storage.read(options.slotKey ?? SAVE_SLOT_KEY);
  if (serialized === null) return false;
  const parsed = parseSave(serialized);
  if (parsed === null) return false;
  if (parsed.pack.id !== options.pack.id || parsed.pack.version !== options.pack.version) {
    return false; // a different world's save is never applied
  }
  const migrated = migrateSave(parsed, options.migrations ?? []);
  if (migrated === null) return false;
  applySave(context.world, migrated, options.slices ?? PROGRESSION_SLICES);
  return true;
}

/**
 * Build the Save/Load System: autosave on key gameplay events. A factory
 * because the System buffers a pending-autosave flag between event flush
 * and update; each booted world gets its own instance.
 */
export function createSaveLoadSystem(options: SaveLoadOptions): System {
  let autosavePending = false;
  let unsubscribes: (() => void)[] = [];

  return {
    id: 'saveload',
    // Ordering only: capture after movement settles the step's positions.
    dependencies: ['movement'],
    init(context: SystemContext): void {
      autosavePending = false;
      for (const type of options.autosaveOn ?? AUTOSAVE_EVENTS) {
        unsubscribes.push(
          context.events.subscribe(type, () => {
            autosavePending = true;
          }),
        );
      }
    },
    update(_dt: number, context: SystemContext): void {
      if (!autosavePending) return;
      autosavePending = false;
      if (saveWorld(context, options)) {
        context.events.publish(WORLD_SAVED, { slot: options.slotKey ?? SAVE_SLOT_KEY });
      }
    },
    teardown(): void {
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      autosavePending = false;
    },
  };
}

/**
 * The save/load plugin: the System plus the event types it introduces,
 * registered and removed as one unit (FR-ARCH-018). A factory so every
 * world composes a fresh System instance.
 */
export function createSaveLoadPlugin(options: SaveLoadOptions): Plugin {
  return {
    id: 'plugin.saveload',
    systems: [createSaveLoadSystem(options)],
    componentTypes: [],
    eventTypes: [WORLD_SAVED, WORLD_RESTORED],
  };
}
