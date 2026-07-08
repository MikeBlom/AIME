import { describe, expect, it } from 'vitest';
import type { ComponentData } from '../core/entity-store.js';
import type { Diagnostic } from './diagnostics.js';
import type { PackFiles } from './loader.js';
import { ENGINE_VERSION, PackLoadError, loadPack, validatePack } from './loader.js';
import { validateAgainstSchema } from './schema-validator.js';
import { CONTENT_SCHEMAS } from './schemas.js';

/** Build a minimal valid pack as in-memory files, overridable per test. */
function makePack(overrides: Record<string, ComponentData | undefined> = {}): PackFiles {
  const base: Record<string, ComponentData> = {
    'pack.json': {
      schemaType: 'pack',
      schemaVersion: '1.0.0',
      id: 'pack.test',
      version: '0.1.0',
      engineCompatibility: '>=0.1.0 <1.0.0',
      creator: { displayName: 'PLACEHOLDER Creator' },
      defaultLocale: 'en',
      entry: { startRegion: 'region.arrival' },
      documents: ['regions/**', 'quests/**', 'metaphors/**', 'strings/**'],
    },
    'regions/arrival.json': {
      schemaType: 'region',
      schemaVersion: '1.0.0',
      id: 'region.arrival',
      displayNameKey: 'region.arrival.name',
      contains: { quests: ['quest.one'] },
    },
    'quests/one.json': {
      schemaType: 'quest',
      schemaVersion: '1.0.0',
      id: 'quest.one',
      titleKey: 'quest.one.title',
      regionRef: 'region.arrival',
      metaphorRef: 'metaphor.one',
    },
    'metaphors/one.json': {
      schemaType: 'metaphor',
      schemaVersion: '1.0.0',
      id: 'metaphor.one',
      mechanic: 'engine.mechanic.route-and-balance',
      framingKey: 'metaphor.one.framing',
    },
    'strings/en/strings.json': {
      schemaType: 'strings',
      schemaVersion: '1.0.0',
      locale: 'en',
      entries: {
        'region.arrival.name': 'PLACEHOLDER name',
        'quest.one.title': 'PLACEHOLDER title',
        'metaphor.one.framing': 'PLACEHOLDER framing',
      },
    },
  };
  const merged = { ...base, ...overrides };
  const files = new Map<string, string>();
  for (const [path, doc] of Object.entries(merged)) {
    if (doc !== undefined) files.set(path, JSON.stringify(doc));
  }
  return files;
}

function errors(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return diagnostics.filter((d) => d.severity === 'error');
}

describe('happy path (DATA-FR-001..006, 018)', () => {
  it('loads a valid pack into a fully linked graph', () => {
    const graph = loadPack(makePack());
    expect(graph.packId).toBe('pack.test');
    expect(graph.startRegion).toBe('region.arrival');
    expect([...graph.entities.keys()]).toEqual(['metaphor.one', 'quest.one', 'region.arrival']);
    expect(graph.byType.get('quest')?.get('quest.one')?.links).toEqual([
      { path: 'regionRef', targetId: 'region.arrival' },
      { path: 'metaphorRef', targetId: 'metaphor.one' },
    ]);
    expect(graph.strings.get('en')?.get('quest.one.title')).toBe('PLACEHOLDER title');
  });

  it('returns an immutable graph: entities and their documents are deep-frozen', () => {
    const graph = loadPack(makePack());
    const quest = graph.entities.get('quest.one');
    expect(Object.isFrozen(quest)).toBe(true);
    expect(Object.isFrozen(quest?.doc)).toBe(true);
    expect(Object.isFrozen(quest?.links)).toBe(true);
  });

  it('every published schema validates its own placeholder example', () => {
    for (const spec of CONTENT_SCHEMAS.values()) {
      const findings = validateAgainstSchema(
        spec.example,
        spec.schema,
        `${spec.schemaType}.example`,
      );
      expect(findings).toEqual([]);
    }
  });
});

describe('rejection diagnostics name document, field, and value (AC1)', () => {
  it('rejects a dangling reference naming referrer, path, and missing id (DATA-FR-007)', () => {
    const files = makePack({
      'quests/one.json': {
        schemaType: 'quest',
        schemaVersion: '1.0.0',
        id: 'quest.one',
        titleKey: 'quest.one.title',
        regionRef: 'region.ghost',
        metaphorRef: 'metaphor.one',
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    const dangling = errors(diagnostics).find((d) => d.rule === 'DATA-FR-007');
    expect(dangling).toMatchObject({
      file: 'quests/one.json',
      path: 'regionRef',
      got: 'region.ghost',
    });
    expect(dangling?.expected).toContain('dangling');
  });

  it('rejects an unknown mechanic naming the metaphor and the catalog (DATA-FR-009)', () => {
    const files = makePack({
      'metaphors/one.json': {
        schemaType: 'metaphor',
        schemaVersion: '1.0.0',
        id: 'metaphor.one',
        mechanic: 'engine.mechanic.does-not-exist',
        framingKey: 'metaphor.one.framing',
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    expect(errors(diagnostics).find((d) => d.rule === 'DATA-FR-009')).toMatchObject({
      file: 'metaphors/one.json',
      path: 'mechanic',
      got: 'engine.mechanic.does-not-exist',
    });
  });

  it('rejects a missing default-locale key naming the document and key (DATA-FR-015)', () => {
    const files = makePack({
      'strings/en/strings.json': {
        schemaType: 'strings',
        schemaVersion: '1.0.0',
        locale: 'en',
        entries: {
          'region.arrival.name': 'PLACEHOLDER name',
          'metaphor.one.framing': 'PLACEHOLDER framing',
        },
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    expect(errors(diagnostics).find((d) => d.rule === 'DATA-FR-015')).toMatchObject({
      file: 'quests/one.json',
      path: 'titleKey',
      got: 'quest.one.title',
    });
  });
});

describe('engine compatibility (AC2, DATA-FR-016)', () => {
  it('rejects an incompatible pack with a version-mismatch message', () => {
    const files = makePack({
      'pack.json': {
        schemaType: 'pack',
        schemaVersion: '1.0.0',
        id: 'pack.test',
        version: '0.1.0',
        engineCompatibility: '>=9.0.0 <10.0.0',
        creator: { displayName: 'PLACEHOLDER Creator' },
        defaultLocale: 'en',
        entry: { startRegion: 'region.arrival' },
        documents: ['regions/**', 'quests/**', 'metaphors/**', 'strings/**'],
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    const mismatch = errors(diagnostics).find((d) => d.rule === 'DATA-FR-016');
    expect(mismatch?.file).toBe('pack.json');
    expect(mismatch?.expected).toContain('version mismatch');
    expect(mismatch?.expected).toContain(ENGINE_VERSION);
  });

  it('rejects a document whose schemaVersion the engine does not publish', () => {
    const files = makePack({
      'regions/arrival.json': {
        schemaType: 'region',
        schemaVersion: '9.9.9',
        id: 'region.arrival',
        displayNameKey: 'region.arrival.name',
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    expect(errors(diagnostics).find((d) => d.rule === 'DATA-FR-016')).toMatchObject({
      file: 'regions/arrival.json',
      path: 'schemaVersion',
      got: '9.9.9',
    });
  });
});

describe('deterministic loading (AC3, DATA-FR-017)', () => {
  it('the same pack always loads to the same content graph', () => {
    const serialize = (files: PackFiles) => {
      const graph = loadPack(files);
      return JSON.stringify({
        packId: graph.packId,
        entities: [...graph.entities.entries()],
        byType: [...graph.byType.entries()].map(([t, m]) => [t, [...m.keys()]]),
        strings: [...graph.strings.entries()].map(([l, m]) => [l, [...m.entries()]]),
      });
    };
    expect(serialize(makePack())).toBe(serialize(makePack()));
  });

  it('file insertion order does not change the graph', () => {
    const ordered = makePack();
    const reversed = new Map([...ordered.entries()].reverse());
    const ids = (files: PackFiles) => [...loadPack(files).entities.keys()];
    expect(ids(reversed)).toEqual(ids(ordered));
  });
});

describe('atomic load and discovery (DATA-FR-002, 020)', () => {
  it('loadPack throws a PackLoadError carrying every diagnostic; no partial graph', () => {
    const files = makePack({ 'quests/one.json': { schemaType: 'quest', schemaVersion: '1.0.0' } });
    let caught: PackLoadError | null = null;
    try {
      loadPack(files);
    } catch (err) {
      caught = err as PackLoadError;
    }
    expect(caught).toBeInstanceOf(PackLoadError);
    expect(errors(caught?.diagnostics ?? []).length).toBeGreaterThan(0);
    expect(caught?.message).toContain('content pack rejected');
  });

  it('ignores stray files not declared by the manifest, with a warning', () => {
    const files = makePack({
      'notes/stray.json': { schemaType: 'region', schemaVersion: '1.0.0', id: 'region.stray' },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).not.toBeNull();
    expect(graph?.entities.has('region.stray')).toBe(false);
    expect(diagnostics.find((d) => d.rule === 'DATA-FR-002')).toMatchObject({
      file: 'notes/stray.json',
      severity: 'warning',
    });
  });

  it('rejects duplicate ids naming both source documents (DATA-FR-005)', () => {
    const files = makePack({
      'regions/arrival-copy.json': {
        schemaType: 'region',
        schemaVersion: '1.0.0',
        id: 'region.arrival',
        displayNameKey: 'region.arrival.name',
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    const dup = errors(diagnostics).find((d) => d.rule === 'DATA-FR-005');
    expect(dup?.expected).toContain('regions/arrival');
  });

  it('rejects a malformed manifest before anything else loads (DATA-FR-001)', () => {
    const files = new Map([['regions/arrival.json', '{}']]);
    const { diagnostics, graph } = validatePack(files);
    expect(graph).toBeNull();
    expect(errors(diagnostics)[0]?.rule).toBe('DATA-FR-001');
  });
});

describe('locale fallback (DATA-FR-025)', () => {
  it('warns for keys missing from a non-default locale instead of failing', () => {
    const files = makePack({
      'strings/fr/strings.json': {
        schemaType: 'strings',
        schemaVersion: '1.0.0',
        locale: 'fr',
        entries: { 'quest.one.title': 'PLACEHOLDER titre' },
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).not.toBeNull();
    const gaps = diagnostics.filter((d) => d.rule === 'DATA-FR-025');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('reachability (DATA-FR-015)', () => {
  it('warns for a region no quest, region, or entry leads to', () => {
    const files = makePack({
      'regions/island.json': {
        schemaType: 'region',
        schemaVersion: '1.0.0',
        id: 'region.island',
        displayNameKey: 'region.arrival.name',
      },
    });
    const { diagnostics, graph } = validatePack(files);
    expect(graph).not.toBeNull();
    expect(
      diagnostics.find((d) => d.severity === 'warning' && d.got === 'region.island'),
    ).toBeDefined();
  });
});
