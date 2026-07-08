/**
 * Content Pack loader and validator — the engine/content contract from
 * docs/03-Data-Model-and-Content-Pipeline.md (DATA-FR-001..020).
 *
 * The pipeline is pure and I/O-free: callers hand it the pack's raw files
 * (path → JSON text) and get back diagnostics and, when clean, a resolved,
 * deep-frozen content graph. The CLI feeds it from the filesystem; the
 * runtime will feed it from fetch — one implementation for both
 * (DATA-FR-013). Loading is atomic (DATA-FR-020): any error means no graph.
 *
 * Determinism (DATA-FR-017): documents are processed in sorted path order
 * and entities land in sorted id order, so the same pack always produces
 * the same graph.
 */
import type { ComponentData } from '../core/entity-store.js';
import { deepFreeze } from '../core/freeze.js';
import type { Diagnostic } from './diagnostics.js';
import { formatDiagnostic, hasErrors } from './diagnostics.js';
import { matchesAnyGlob } from './glob.js';
import { validateAgainstSchema } from './schema-validator.js';
import type { ContentTypeSpec } from './schemas.js';
import { CONTENT_SCHEMAS, ENGINE_MECHANICS } from './schemas.js';
import { isValidRange, satisfies } from './semver.js';

/** The engine version packs declare compatibility against (DATA-FR-016). */
export const ENGINE_VERSION = '0.1.0';

export const MANIFEST_PATH = 'pack.json';

/** A pack's raw files: pack-relative path → raw JSON text. */
export type PackFiles = ReadonlyMap<string, string>;

export interface LoadPackOptions {
  /** Defaults to ENGINE_VERSION; injectable for tests and future hosts. */
  readonly engineVersion?: string;
  /** Known mechanic type ids; plugins extend this catalog (DATA-FR-009). */
  readonly knownMechanics?: readonly string[];
}

/** One resolved content entity: its type, source document, and frozen data. */
export interface ResolvedEntity {
  readonly id: string;
  readonly schemaType: string;
  readonly file: string;
  readonly doc: Readonly<Record<string, ComponentData>>;
  /** Outgoing links, fully resolved at load time (DATA-FR-018). */
  readonly links: readonly { readonly path: string; readonly targetId: string }[];
}

/** The immutable, fully linked content graph Systems consume (DATA-FR-018). */
export interface ResolvedContentGraph {
  readonly packId: string;
  readonly packVersion: string;
  readonly defaultLocale: string;
  readonly startRegion: string;
  /** Every entity by id, in sorted id order (DATA-FR-017). */
  readonly entities: ReadonlyMap<string, ResolvedEntity>;
  /** Entities grouped by schemaType, each in sorted id order. */
  readonly byType: ReadonlyMap<string, ReadonlyMap<string, ResolvedEntity>>;
  /** Locale → key → text, in sorted order (DATA-FR-011/024). */
  readonly strings: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export interface ValidatePackResult {
  readonly diagnostics: readonly Diagnostic[];
  /** Present only when no diagnostic is an error (DATA-FR-020). */
  readonly graph: ResolvedContentGraph | null;
}

/** Atomic-load failure (DATA-FR-020): carries every diagnostic found. */
export class PackLoadError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    const errors = diagnostics.filter((d) => d.severity === 'error');
    super(
      `content pack rejected with ${errors.length} error(s):\n` +
        errors.slice(0, 20).map(formatDiagnostic).join('\n'),
    );
    this.name = 'PackLoadError';
    this.diagnostics = diagnostics;
  }
}

type JsonRecord = Readonly<Record<string, ComponentData>>;

interface ParsedDoc {
  readonly file: string;
  readonly doc: JsonRecord;
  readonly spec: ContentTypeSpec;
}

function error(file: string, path: string, expected: string, got: ComponentData, rule: string) {
  return { file, path, expected, got, severity: 'error', rule } as const;
}

function warning(file: string, path: string, expected: string, got: ComponentData, rule: string) {
  return { file, path, expected, got, severity: 'warning', rule } as const;
}

function parseDocument(file: string, text: string, out: Diagnostic[]): JsonRecord | null {
  let parsed: ComponentData;
  try {
    parsed = JSON.parse(text) as ComponentData;
  } catch (err) {
    out.push(
      error(file, '(document)', 'well-formed JSON', String((err as Error).message), 'DATA-FR-012'),
    );
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    out.push(error(file, '(document)', 'a JSON object document', parsed, 'DATA-FR-003'));
    return null;
  }
  return parsed as JsonRecord;
}

/**
 * Validate a pack's files end to end: manifest, per-document schemas,
 * cross-document reference integrity, mechanics, locale keys, and
 * reachability. Returns every diagnostic plus the graph when clean.
 */
export function validatePack(files: PackFiles, options: LoadPackOptions = {}): ValidatePackResult {
  const engineVersion = options.engineVersion ?? ENGINE_VERSION;
  const knownMechanics = options.knownMechanics ?? ENGINE_MECHANICS;
  const diagnostics: Diagnostic[] = [];

  // Manifest first: without it there is no pack (DATA-FR-001).
  const manifestText = files.get(MANIFEST_PATH);
  if (manifestText === undefined) {
    diagnostics.push(
      error(
        MANIFEST_PATH,
        '(document)',
        'a pack.json manifest (DATA-FR-001)',
        'missing',
        'DATA-FR-001',
      ),
    );
    return { diagnostics, graph: null };
  }
  const manifest = parseDocument(MANIFEST_PATH, manifestText, diagnostics);
  if (manifest === null) return { diagnostics, graph: null };
  const packSpec = CONTENT_SCHEMAS.get('pack') as ContentTypeSpec;
  diagnostics.push(...validateAgainstSchema(manifest, packSpec.schema, MANIFEST_PATH));
  if (hasErrors(diagnostics)) return { diagnostics, graph: null };

  // Engine compatibility (DATA-FR-016).
  const range = manifest['engineCompatibility'] as string;
  if (!isValidRange(range)) {
    diagnostics.push(
      error(
        MANIFEST_PATH,
        'engineCompatibility',
        'a version range like ">=1.0.0 <2.0.0"',
        range,
        'DATA-FR-016',
      ),
    );
    return { diagnostics, graph: null };
  }
  if (!satisfies(engineVersion, range)) {
    diagnostics.push(
      error(
        MANIFEST_PATH,
        'engineCompatibility',
        `version mismatch: a range compatible with engine version ${engineVersion}`,
        range,
        'DATA-FR-016',
      ),
    );
    return { diagnostics, graph: null };
  }

  // Document discovery: only manifest-declared files load; stray files are
  // ignored loudly, never silently effective (DATA-FR-002).
  const globs = manifest['documents'] as readonly string[];
  const declared: string[] = [];
  for (const path of [...files.keys()].sort()) {
    if (path === MANIFEST_PATH) continue;
    if (matchesAnyGlob(path, globs)) {
      declared.push(path);
    } else {
      diagnostics.push(
        warning(
          path,
          '(document)',
          'a file declared by manifest `documents`; ignored',
          path,
          'DATA-FR-002',
        ),
      );
    }
  }

  // Per-document parse + schema validation (DATA-FR-003/012).
  const parsed: ParsedDoc[] = [];
  for (const file of declared) {
    const doc = parseDocument(file, files.get(file) as string, diagnostics);
    if (doc === null) continue;
    const schemaType = doc['schemaType'];
    const spec = typeof schemaType === 'string' ? CONTENT_SCHEMAS.get(schemaType) : undefined;
    if (spec === undefined || spec.schemaType === 'pack') {
      diagnostics.push(
        error(
          file,
          'schemaType',
          `one of ${JSON.stringify([...CONTENT_SCHEMAS.keys()].filter((t) => t !== 'pack'))}`,
          schemaType ?? 'missing',
          'DATA-FR-003',
        ),
      );
      continue;
    }
    if (doc['schemaVersion'] !== spec.schemaVersion) {
      diagnostics.push(
        error(
          file,
          'schemaVersion',
          `version mismatch: this engine publishes ${spec.schemaType} schema ${spec.schemaVersion}`,
          doc['schemaVersion'] ?? 'missing',
          'DATA-FR-016',
        ),
      );
      continue;
    }
    const structural = validateAgainstSchema(doc, spec.schema, file);
    diagnostics.push(...structural);
    if (structural.length === 0) parsed.push({ file, doc, spec });
  }

  // Pack-unique ids (DATA-FR-005/008), duplicates named with both locations.
  const byId = new Map<string, ParsedDoc>();
  for (const entry of parsed) {
    if (entry.spec.schemaType === 'strings') continue;
    const id = entry.doc['id'] as string;
    const existing = byId.get(id);
    if (existing !== undefined) {
      diagnostics.push(
        error(
          entry.file,
          'id',
          `a pack-unique id (already declared in ${existing.file})`,
          id,
          'DATA-FR-005',
        ),
      );
    } else {
      byId.set(id, entry);
    }
  }

  // Locale tables (DATA-FR-011/024): merge strings docs per locale.
  const defaultLocale = manifest['defaultLocale'] as string;
  const strings = new Map<string, Map<string, string>>();
  for (const entry of parsed) {
    if (entry.spec.schemaType !== 'strings') continue;
    const locale = entry.doc['locale'] as string;
    const table = strings.get(locale) ?? new Map<string, string>();
    strings.set(locale, table);
    const entryPairs = Object.entries((entry.doc['entries'] ?? {}) as JsonRecord);
    for (const [key, text] of entryPairs.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (typeof text !== 'string') {
        diagnostics.push(
          error(entry.file, `entries.${key}`, 'a string value', text, 'DATA-FR-011'),
        );
      } else if (table.has(key)) {
        diagnostics.push(
          error(
            entry.file,
            `entries.${key}`,
            `a locale-unique key (already defined for "${locale}")`,
            key,
            'DATA-FR-011',
          ),
        );
      } else {
        table.set(key, text);
      }
    }
  }
  const defaultTable = strings.get(defaultLocale);
  if (defaultTable === undefined) {
    diagnostics.push(
      error(
        MANIFEST_PATH,
        'defaultLocale',
        'a strings document for the default locale (DATA-FR-011)',
        defaultLocale,
        'DATA-FR-015',
      ),
    );
  }

  // Cross-document checks (DATA-FR-007/009/015).
  const referencedIds = new Set<string>();
  for (const entry of [...parsed, { file: MANIFEST_PATH, doc: manifest, spec: packSpec }]) {
    for (const ref of entry.spec.refs?.(entry.doc) ?? []) {
      referencedIds.add(ref.id);
      const target = byId.get(ref.id);
      if (target === undefined) {
        diagnostics.push(
          error(
            entry.file,
            ref.path,
            `an existing ${ref.targetType} id (dangling reference)`,
            ref.id,
            'DATA-FR-007',
          ),
        );
      } else if (target.spec.schemaType !== ref.targetType) {
        diagnostics.push(
          error(
            entry.file,
            ref.path,
            `a ${ref.targetType} id, not a ${target.spec.schemaType} id`,
            ref.id,
            'DATA-FR-007',
          ),
        );
      }
    }
    for (const { path, key } of entry.spec.keys?.(entry.doc) ?? []) {
      if (defaultTable !== undefined && !defaultTable.has(key)) {
        diagnostics.push(
          error(
            entry.file,
            path,
            `a key present in the default locale "${defaultLocale}" strings`,
            key,
            'DATA-FR-015',
          ),
        );
      }
    }
    if (entry.spec.schemaType === 'metaphor') {
      const mechanic = entry.doc['mechanic'] as string;
      if (!knownMechanics.includes(mechanic)) {
        diagnostics.push(
          error(
            entry.file,
            'mechanic',
            `a known engine mechanic, one of ${JSON.stringify(knownMechanics)}`,
            mechanic,
            'DATA-FR-009',
          ),
        );
      }
    }
    if (entry.spec.schemaType === 'dialogue') {
      diagnostics.push(...checkDialogueNodes(entry));
    }
  }

  // Non-default locales fall back to the default; gaps are warnings (DATA-FR-025).
  if (defaultTable !== undefined) {
    for (const [locale, table] of strings) {
      if (locale === defaultLocale) continue;
      for (const key of defaultTable.keys()) {
        if (!table.has(key)) {
          diagnostics.push(
            warning(
              `strings (locale "${locale}")`,
              key,
              `a "${locale}" translation; falls back to "${defaultLocale}"`,
              'missing',
              'DATA-FR-025',
            ),
          );
        }
      }
      for (const key of table.keys()) {
        if (!defaultTable.has(key)) {
          diagnostics.push(
            warning(
              `strings (locale "${locale}")`,
              key,
              'a key also present in the default locale (its source of truth)',
              key,
              'DATA-FR-025',
            ),
          );
        }
      }
    }
  }

  // Reachability (DATA-FR-015): a region nothing leads to is at least a warning.
  const startRegion = (manifest['entry'] as JsonRecord)['startRegion'] as string;
  for (const [id, entry] of byId) {
    if (entry.spec.schemaType === 'region' && id !== startRegion && !referencedIds.has(id)) {
      diagnostics.push(
        warning(
          entry.file,
          'id',
          'a region referenced by a quest, region, or the pack entry',
          id,
          'DATA-FR-015',
        ),
      );
    }
  }

  if (hasErrors(diagnostics)) return { diagnostics, graph: null };

  // Resolution into the immutable, fully linked graph (DATA-FR-017/018/020).
  const entities = new Map<string, ResolvedEntity>();
  for (const id of [...byId.keys()].sort()) {
    const entry = byId.get(id) as ParsedDoc;
    const links = (entry.spec.refs?.(entry.doc) ?? []).map((ref) =>
      Object.freeze({ path: ref.path, targetId: ref.id }),
    );
    entities.set(
      id,
      Object.freeze({
        id,
        schemaType: entry.spec.schemaType,
        file: entry.file,
        doc: deepFreeze(entry.doc),
        links: Object.freeze(links),
      }),
    );
  }
  const byType = new Map<string, Map<string, ResolvedEntity>>();
  for (const [id, entity] of entities) {
    const table = byType.get(entity.schemaType) ?? new Map<string, ResolvedEntity>();
    table.set(id, entity);
    byType.set(entity.schemaType, table);
  }
  const frozenStrings = new Map<string, ReadonlyMap<string, string>>();
  for (const locale of [...strings.keys()].sort()) {
    const table = strings.get(locale) as Map<string, string>;
    frozenStrings.set(locale, new Map([...table.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))));
  }
  const graph: ResolvedContentGraph = Object.freeze({
    packId: manifest['id'] as string,
    packVersion: manifest['version'] as string,
    defaultLocale,
    startRegion,
    entities,
    byType,
    strings: frozenStrings,
  });
  return { diagnostics, graph };
}

/** Dialogue `goto` targets are intra-document references (DATA-FR-007). */
function checkDialogueNodes(entry: ParsedDoc): Diagnostic[] {
  const out: Diagnostic[] = [];
  const nodes = (entry.doc['nodes'] ?? []) as readonly JsonRecord[];
  const nodeIds = new Set(nodes.map((node) => node['id'] as string));
  nodes.forEach((node, i) => {
    const choices = (node['choices'] ?? []) as readonly JsonRecord[];
    choices.forEach((choice, j) => {
      const target = choice['goto'];
      if (typeof target === 'string' && !nodeIds.has(target)) {
        out.push(
          error(
            entry.file,
            `nodes[${i}].choices[${j}].goto`,
            'an existing dialogue node id (dangling reference)',
            target,
            'DATA-FR-007',
          ),
        );
      }
    });
  });
  return out;
}

/**
 * The `loadPack` contract (DATA-FR-018/020): returns the resolved graph or
 * throws a PackLoadError carrying every diagnostic. Warnings never block.
 */
export function loadPack(files: PackFiles, options: LoadPackOptions = {}): ResolvedContentGraph {
  const { diagnostics, graph } = validatePack(files, options);
  if (graph === null) throw new PackLoadError(diagnostics);
  return graph;
}
