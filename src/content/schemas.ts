/**
 * Published content schemas (DATA-FR-003/012): the versioned artifacts the
 * runtime loader and the standalone CI validator share, one per content
 * type, each with a placeholder example. Schemas describe structure only —
 * they hold zero career facts; every example is the placeholder shape from
 * docs/03-Data-Model-and-Content-Pipeline.md.
 *
 * Cross-document knowledge also lives here as data: which fields reference
 * which content type (DATA-FR-006/007) and which fields are locale keys
 * (DATA-FR-011/015), so the loader stays generic.
 */
import type { ComponentData } from '../core/entity-store.js';
import type { ContentSchema } from './schema-validator.js';

/** Namespaced id: `type.name` (DATA-FR-005/008). */
export const ID_PATTERN = '^[a-z0-9-]+(\\.[a-z0-9-]+)+$';
const SEMVER_PATTERN = '^\\d+\\.\\d+\\.\\d+$';

function idOf(prefix: string): ContentSchema {
  return {
    type: 'string',
    pattern: `^${prefix}\\.[a-z0-9-]+(\\.[a-z0-9-]+)*$`,
    description: `namespaced \`${prefix}.name\` id (DATA-FR-008)`,
  };
}

const LOCALE_KEY: ContentSchema = {
  type: 'string',
  pattern: ID_PATTERN,
  description: 'locale string key, never inline player text (DATA-FR-011)',
};

/** One reference from a document field to another content entity (DATA-FR-006). */
export interface ExtractedRef {
  readonly path: string;
  readonly targetType: string;
  readonly id: string;
}

/** One locale-key usage in a document field (DATA-FR-011). */
export interface ExtractedKey {
  readonly path: string;
  readonly key: string;
}

export interface ContentTypeSpec {
  readonly schemaType: string;
  readonly schemaVersion: string;
  readonly schema: ContentSchema;
  /** Placeholder example document, valid against `schema`. */
  readonly example: ComponentData;
  /** Pull cross-document references out of a valid document. */
  readonly refs?: (doc: Readonly<Record<string, ComponentData>>) => ExtractedRef[];
  /** Pull locale-key usages out of a valid document. */
  readonly keys?: (doc: Readonly<Record<string, ComponentData>>) => ExtractedKey[];
}

function base(schemaType: string, idPrefix: string, rest: ContentSchema): ContentSchema {
  return {
    type: 'object',
    required: ['schemaType', 'schemaVersion', 'id', ...(rest.required ?? [])],
    properties: {
      schemaType: { enum: [schemaType] },
      schemaVersion: { type: 'string', pattern: SEMVER_PATTERN },
      id: idOf(idPrefix),
      ...rest.properties,
    },
  };
}

function strings(doc: Readonly<Record<string, ComponentData>>, field: string): string[] {
  const value = doc[field];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const PACK: ContentTypeSpec = {
  schemaType: 'pack',
  schemaVersion: '1.0.0',
  schema: {
    type: 'object',
    required: [
      'schemaType',
      'schemaVersion',
      'id',
      'version',
      'engineCompatibility',
      'creator',
      'defaultLocale',
      'entry',
      'documents',
    ],
    properties: {
      schemaType: { enum: ['pack'] },
      schemaVersion: { type: 'string', pattern: SEMVER_PATTERN },
      id: idOf('pack'),
      version: { type: 'string', pattern: SEMVER_PATTERN, description: 'semantic version X.Y.Z' },
      engineCompatibility: {
        type: 'string',
        description: 'engine version range, e.g. ">=1.0.0 <2.0.0" (DATA-FR-016)',
      },
      creator: {
        type: 'object',
        required: ['displayName'],
        properties: { displayName: { type: 'string' }, tagline: { type: 'string' } },
      },
      defaultLocale: { type: 'string' },
      entry: {
        type: 'object',
        required: ['startRegion'],
        properties: { startRegion: idOf('region') },
      },
      documents: { type: 'array', items: { type: 'string' } },
    },
  },
  example: {
    schemaType: 'pack',
    schemaVersion: '1.0.0',
    id: 'pack.reference',
    version: '0.1.0',
    engineCompatibility: '>=0.1.0 <1.0.0',
    creator: { displayName: 'PLACEHOLDER Creator Name', tagline: 'PLACEHOLDER one-line framing' },
    defaultLocale: 'en',
    entry: { startRegion: 'region.arrival' },
    documents: ['regions/**', 'quests/**', 'strings/**'],
  },
  refs: (doc) => {
    const entry = doc['entry'] as Readonly<Record<string, ComponentData>> | undefined;
    const start = entry?.['startRegion'];
    return typeof start === 'string'
      ? [{ path: 'entry.startRegion', targetType: 'region', id: start }]
      : [];
  },
};

const REGION: ContentTypeSpec = {
  schemaType: 'region',
  schemaVersion: '1.0.0',
  schema: base('region', 'region', {
    required: ['displayNameKey'],
    properties: {
      displayNameKey: LOCALE_KEY,
      state: { type: 'object' },
      bounds: { type: 'object' },
      contains: {
        type: 'object',
        properties: {
          buildings: { type: 'array', items: idOf('building') },
          npcs: { type: 'array', items: idOf('npc') },
          quests: { type: 'array', items: idOf('quest') },
        },
      },
      ambient: { type: 'object' },
    },
  }),
  example: {
    schemaType: 'region',
    schemaVersion: '1.0.0',
    id: 'region.arrival',
    displayNameKey: 'region.arrival.name',
    state: { initial: 'offline' },
    contains: { buildings: [], npcs: [], quests: [] },
  },
  refs: (doc) => {
    const contains = (doc['contains'] ?? {}) as Readonly<Record<string, ComponentData>>;
    const out: ExtractedRef[] = [];
    for (const [field, targetType] of [
      ['buildings', 'building'],
      ['npcs', 'npc'],
      ['quests', 'quest'],
    ] as const) {
      strings(contains, field).forEach((id, i) =>
        out.push({ path: `contains.${field}[${i}]`, targetType, id }),
      );
    }
    return out;
  },
  keys: (doc) =>
    typeof doc['displayNameKey'] === 'string'
      ? [{ path: 'displayNameKey', key: doc['displayNameKey'] }]
      : [],
};

/** A rectangle in room-local units, positioned by its center. */
const INTERIOR_RECT: ContentSchema = {
  type: 'object',
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
  },
};

/**
 * A building's interior (issue #30): room size, player spawn, solid
 * furnishing colliders, and interaction points, all in room-local units.
 * A building without this block is set dressing — not enterable.
 */
const BUILDING_INTERIOR: ContentSchema = {
  type: 'object',
  properties: {
    size: {
      type: 'object',
      required: ['width', 'height'],
      properties: { width: { type: 'number' }, height: { type: 'number' } },
    },
    spawn: {
      type: 'object',
      required: ['x', 'y'],
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    colliders: { type: 'array', items: INTERIOR_RECT },
    points: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'hintKey', 'x', 'y'],
        properties: {
          id: { type: 'string' },
          hintKey: LOCALE_KEY,
          x: { type: 'number' },
          y: { type: 'number' },
        },
      },
    },
  },
};

const BUILDING: ContentTypeSpec = {
  schemaType: 'building',
  schemaVersion: '1.0.0',
  schema: base('building', 'building', {
    required: ['displayNameKey'],
    properties: { displayNameKey: LOCALE_KEY, interior: BUILDING_INTERIOR },
  }),
  example: {
    schemaType: 'building',
    schemaVersion: '1.0.0',
    id: 'building.control-house',
    displayNameKey: 'building.control-house.name',
    interior: {
      size: { width: 160, height: 110 },
      spawn: { x: 80, y: 88 },
      colliders: [{ x: 80, y: 30, width: 40, height: 12 }],
      points: [
        { id: 'point.console', hintKey: 'building.control-house.point.console', x: 80, y: 40 },
      ],
    },
  },
  keys: (doc) => {
    const out: ExtractedKey[] = [];
    if (typeof doc['displayNameKey'] === 'string') {
      out.push({ path: 'displayNameKey', key: doc['displayNameKey'] });
    }
    const interior =
      typeof doc['interior'] === 'object' &&
      doc['interior'] !== null &&
      !Array.isArray(doc['interior'])
        ? (doc['interior'] as Readonly<Record<string, ComponentData>>)
        : undefined;
    const points =
      interior !== undefined && Array.isArray(interior['points']) ? interior['points'] : [];
    points.forEach((point, i) => {
      const key = (point as Readonly<Record<string, ComponentData>>)['hintKey'];
      if (typeof key === 'string') out.push({ path: `interior.points[${i}].hintKey`, key });
    });
    return out;
  },
};

const NPC: ContentTypeSpec = {
  schemaType: 'npc',
  schemaVersion: '1.0.0',
  schema: base('npc', 'npc', {
    required: ['displayNameKey'],
    properties: {
      displayNameKey: LOCALE_KEY,
      appearance: { type: 'object' },
      routine: { type: 'array', items: { type: 'object' } },
      dialogueRef: idOf('dialogue'),
      role: { type: 'string', description: 'author-facing note, never rendered (DATA-FR-010)' },
    },
  }),
  example: {
    schemaType: 'npc',
    schemaVersion: '1.0.0',
    id: 'npc.foreman',
    displayNameKey: 'npc.foreman.name',
    dialogueRef: 'dialogue.foreman-intro',
    role: 'PLACEHOLDER narrative role',
  },
  refs: (doc) =>
    typeof doc['dialogueRef'] === 'string'
      ? [{ path: 'dialogueRef', targetType: 'dialogue', id: doc['dialogueRef'] }]
      : [],
  keys: (doc) =>
    typeof doc['displayNameKey'] === 'string'
      ? [{ path: 'displayNameKey', key: doc['displayNameKey'] }]
      : [],
};

const QUEST: ContentTypeSpec = {
  schemaType: 'quest',
  schemaVersion: '1.0.0',
  schema: base('quest', 'quest', {
    required: ['titleKey', 'regionRef', 'metaphorRef'],
    properties: {
      titleKey: LOCALE_KEY,
      regionRef: idOf('region'),
      metaphorRef: idOf('metaphor'),
      objectives: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'descriptionKey'],
          properties: { id: { type: 'string' }, descriptionKey: LOCALE_KEY },
        },
      },
      onComplete: {
        type: 'object',
        properties: {
          emits: { type: 'array', items: { type: 'string' } },
          revealsKey: LOCALE_KEY,
          worldEffect: { type: 'string' },
          // Completion grants (issue #31): capability and item ids the
          // Progression System records; ids are pack vocabulary.
          grants: {
            type: 'object',
            properties: {
              capabilities: { type: 'array', items: idOf('capability') },
              items: { type: 'array', items: idOf('item') },
            },
          },
        },
      },
      bypass: {
        type: 'object',
        required: ['allowed'],
        properties: { allowed: { type: 'boolean' }, revealsKey: LOCALE_KEY },
      },
    },
  }),
  example: {
    schemaType: 'quest',
    schemaVersion: '1.0.0',
    id: 'quest.restore-power',
    titleKey: 'quest.restore-power.title',
    regionRef: 'region.arrival',
    metaphorRef: 'metaphor.distributed-systems',
    objectives: [{ id: 'obj.route-power', descriptionKey: 'quest.restore-power.obj.route' }],
    bypass: { allowed: true, revealsKey: 'quest.restore-power.reveal' },
  },
  refs: (doc) => {
    const out: ExtractedRef[] = [];
    if (typeof doc['regionRef'] === 'string') {
      out.push({ path: 'regionRef', targetType: 'region', id: doc['regionRef'] });
    }
    if (typeof doc['metaphorRef'] === 'string') {
      out.push({ path: 'metaphorRef', targetType: 'metaphor', id: doc['metaphorRef'] });
    }
    return out;
  },
  keys: (doc) => {
    const out: ExtractedKey[] = [];
    if (typeof doc['titleKey'] === 'string') out.push({ path: 'titleKey', key: doc['titleKey'] });
    const objectives = Array.isArray(doc['objectives']) ? doc['objectives'] : [];
    objectives.forEach((objective, i) => {
      const key = (objective as Readonly<Record<string, ComponentData>>)['descriptionKey'];
      if (typeof key === 'string') out.push({ path: `objectives[${i}].descriptionKey`, key });
    });
    for (const field of ['onComplete', 'bypass'] as const) {
      const block = doc[field] as Readonly<Record<string, ComponentData>> | undefined;
      const key = block?.['revealsKey'];
      if (typeof key === 'string') out.push({ path: `${field}.revealsKey`, key });
    }
    return out;
  },
};

/**
 * Optional dialogue hook (DATA-FR-009's spirit): a node or choice may
 * declare that taking it resolves a quest objective, feeding the quest
 * engine's standardized result event. Structure only — which quest means
 * what stays in the pack.
 */
const DIALOGUE_RESOLVES: ContentSchema = {
  type: 'object',
  required: ['questRef', 'objectiveId'],
  properties: {
    questRef: idOf('quest'),
    objectiveId: { type: 'string' },
    outcome: { enum: ['solved', 'bypassed'] },
  },
};

const DIALOGUE: ContentTypeSpec = {
  schemaType: 'dialogue',
  schemaVersion: '1.0.0',
  schema: base('dialogue', 'dialogue', {
    required: ['nodes'],
    properties: {
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'textKey'],
          properties: {
            id: { type: 'string' },
            textKey: LOCALE_KEY,
            end: { type: 'boolean' },
            resolves: DIALOGUE_RESOLVES,
            choices: {
              type: 'array',
              items: {
                type: 'object',
                required: ['textKey', 'goto'],
                properties: {
                  textKey: LOCALE_KEY,
                  goto: { type: 'string' },
                  resolves: DIALOGUE_RESOLVES,
                },
              },
            },
          },
        },
      },
    },
  }),
  example: {
    schemaType: 'dialogue',
    schemaVersion: '1.0.0',
    id: 'dialogue.foreman-intro',
    nodes: [
      {
        id: 'n1',
        textKey: 'dialogue.foreman-intro.n1',
        choices: [{ textKey: 'dialogue.foreman-intro.n1.c1', goto: 'n2' }],
      },
      { id: 'n2', textKey: 'dialogue.foreman-intro.n2', end: true },
    ],
  },
  refs: (doc) => {
    const out: ExtractedRef[] = [];
    const questRefOf = (value: ComponentData | undefined): string | null => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
      const ref = (value as Readonly<Record<string, ComponentData>>)['questRef'];
      return typeof ref === 'string' ? ref : null;
    };
    const nodes = Array.isArray(doc['nodes']) ? doc['nodes'] : [];
    nodes.forEach((node, i) => {
      const record = node as Readonly<Record<string, ComponentData>>;
      const nodeRef = questRefOf(record['resolves']);
      if (nodeRef !== null) {
        out.push({ path: `nodes[${i}].resolves.questRef`, targetType: 'quest', id: nodeRef });
      }
      const choices = Array.isArray(record['choices']) ? record['choices'] : [];
      choices.forEach((choice, j) => {
        const choiceRef = questRefOf(
          (choice as Readonly<Record<string, ComponentData>>)['resolves'],
        );
        if (choiceRef !== null) {
          out.push({
            path: `nodes[${i}].choices[${j}].resolves.questRef`,
            targetType: 'quest',
            id: choiceRef,
          });
        }
      });
    });
    return out;
  },
  keys: (doc) => {
    const out: ExtractedKey[] = [];
    const nodes = Array.isArray(doc['nodes']) ? doc['nodes'] : [];
    nodes.forEach((node, i) => {
      const record = node as Readonly<Record<string, ComponentData>>;
      if (typeof record['textKey'] === 'string') {
        out.push({ path: `nodes[${i}].textKey`, key: record['textKey'] });
      }
      const choices = Array.isArray(record['choices']) ? record['choices'] : [];
      choices.forEach((choice, j) => {
        const key = (choice as Readonly<Record<string, ComponentData>>)['textKey'];
        if (typeof key === 'string') out.push({ path: `nodes[${i}].choices[${j}].textKey`, key });
      });
    });
    return out;
  },
};

const METAPHOR: ContentTypeSpec = {
  schemaType: 'metaphor',
  schemaVersion: '1.0.0',
  schema: base('metaphor', 'metaphor', {
    required: ['mechanic', 'framingKey'],
    properties: {
      accomplishment: {
        type: 'string',
        description: 'author-facing note, never rendered to the player (DATA-FR-010)',
      },
      mechanic: {
        type: 'string',
        pattern: '^engine\\.mechanic\\.[a-z0-9-]+$',
        description: 'engine-provided mechanic type id (DATA-FR-009)',
      },
      params: { type: 'object' },
      framingKey: LOCALE_KEY,
    },
  }),
  example: {
    schemaType: 'metaphor',
    schemaVersion: '1.0.0',
    id: 'metaphor.distributed-systems',
    accomplishment: 'PLACEHOLDER author-facing note',
    mechanic: 'engine.mechanic.route-and-balance',
    framingKey: 'metaphor.distributed-systems.framing',
  },
  keys: (doc) =>
    typeof doc['framingKey'] === 'string' ? [{ path: 'framingKey', key: doc['framingKey'] }] : [],
};

const ACHIEVEMENT: ContentTypeSpec = {
  schemaType: 'achievement',
  schemaVersion: '1.0.0',
  schema: base('achievement', 'achievement', {
    required: ['titleKey'],
    properties: {
      titleKey: LOCALE_KEY,
      descriptionKey: LOCALE_KEY,
      // The unlock rule (issue #32): an engine rule kind bound to pack
      // ids/counts. An achievement without one never self-unlocks.
      unlock: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: {
            enum: [
              'restored-region',
              'restored-count',
              'quest-completed',
              'capability-unlocked',
              'item-added',
              'building-entered',
            ],
          },
          ref: { type: 'string', pattern: ID_PATTERN },
          count: { type: 'number' },
        },
      },
    },
  }),
  example: {
    schemaType: 'achievement',
    schemaVersion: '1.0.0',
    id: 'achievement.first-light',
    titleKey: 'achievement.first-light.title',
    descriptionKey: 'achievement.first-light.description',
    unlock: { kind: 'restored-count', count: 1 },
  },
  refs: (doc) => {
    const unlock = doc['unlock'];
    if (typeof unlock !== 'object' || unlock === null || Array.isArray(unlock)) return [];
    const record = unlock as Readonly<Record<string, ComponentData>>;
    const targetByKind: Readonly<Record<string, string>> = {
      'restored-region': 'region',
      'quest-completed': 'quest',
      'building-entered': 'building',
    };
    const kind = record['kind'];
    const ref = record['ref'];
    const targetType = typeof kind === 'string' ? targetByKind[kind] : undefined;
    return targetType !== undefined && typeof ref === 'string'
      ? [{ path: 'unlock.ref', targetType, id: ref }]
      : [];
  },
  keys: (doc) => {
    const out: ExtractedKey[] = [];
    for (const field of ['titleKey', 'descriptionKey'] as const) {
      const key = doc[field];
      if (typeof key === 'string') out.push({ path: field, key });
    }
    return out;
  },
};

const MINIGAME: ContentTypeSpec = {
  schemaType: 'minigame',
  schemaVersion: '1.0.0',
  schema: base('minigame', 'minigame', {
    required: ['displayNameKey', 'plugin'],
    properties: {
      displayNameKey: LOCALE_KEY,
      plugin: { type: 'string', description: 'engine plugin id providing the behavior' },
      config: { type: 'object' },
    },
  }),
  example: {
    schemaType: 'minigame',
    schemaVersion: '1.0.0',
    id: 'minigame.route-and-balance',
    displayNameKey: 'minigame.route-and-balance.name',
    plugin: 'plugin.minigame-host',
  },
  keys: (doc) =>
    typeof doc['displayNameKey'] === 'string'
      ? [{ path: 'displayNameKey', key: doc['displayNameKey'] }]
      : [],
};

const STRINGS: ContentTypeSpec = {
  schemaType: 'strings',
  schemaVersion: '1.0.0',
  schema: {
    type: 'object',
    required: ['schemaType', 'schemaVersion', 'locale', 'entries'],
    properties: {
      schemaType: { enum: ['strings'] },
      schemaVersion: { type: 'string', pattern: SEMVER_PATTERN },
      locale: { type: 'string' },
      entries: { type: 'object' },
    },
  },
  example: {
    schemaType: 'strings',
    schemaVersion: '1.0.0',
    locale: 'en',
    entries: { 'region.arrival.name': 'PLACEHOLDER The Arrival Yard' },
  },
};

/**
 * The asset manifest (DATA-FR-019): asset id → address (a pack-relative
 * path, URL, or data URI). Large assets are referenced here and loaded off
 * the critical path; rendering resolves sprite refs through these entries.
 */
const ASSETS: ContentTypeSpec = {
  schemaType: 'assets',
  schemaVersion: '1.0.0',
  schema: base('assets', 'assets', {
    required: ['entries'],
    properties: {
      entries: {
        type: 'object',
        description: 'asset id -> address (path, URL, or data URI); addresses are data, not code',
      },
    },
  }),
  example: {
    schemaType: 'assets',
    schemaVersion: '1.0.0',
    id: 'assets.manifest',
    entries: { 'asset.npc.placeholder': 'assets/sprites/placeholder.png' },
  },
};

/** The published catalog, keyed by `schemaType` (DATA-FR-003). */
export const CONTENT_SCHEMAS: ReadonlyMap<string, ContentTypeSpec> = new Map(
  [
    PACK,
    REGION,
    BUILDING,
    NPC,
    QUEST,
    DIALOGUE,
    METAPHOR,
    ACHIEVEMENT,
    MINIGAME,
    STRINGS,
    ASSETS,
  ].map((spec) => [spec.schemaType, spec]),
);

/**
 * Engine-provided mechanic types metaphors may bind to (DATA-FR-009).
 * Grows as mechanic plugins land; the loader also accepts an explicit
 * catalog so plugin-registered mechanics can extend it (FR-ARCH-018).
 */
export const ENGINE_MECHANICS: readonly string[] = ['engine.mechanic.route-and-balance'];

/**
 * Params schemas per engine mechanic (issue #33; docs/03 edge case "a
 * metaphor binds to a mechanic whose params schema it violates"): where a
 * mechanic publishes a schema, the loader validates a metaphor's `params`
 * against it with field-level diagnostics. A mechanic without an entry
 * accepts any params shape. Grows with the mechanic catalog (#34); the
 * loader also accepts an explicit map so plugin-provided mechanics
 * validate the same way (FR-ARCH-018).
 */
export const ENGINE_MECHANIC_PARAMS: Readonly<Record<string, ContentSchema>> = {};
