import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverPacks, validateContentRoot, validatePack } from './validate-content.mjs';

const VALID_MANIFEST = {
  schemaType: 'pack',
  schemaVersion: '1.0',
  id: 'pack.reference',
  version: '0.1.0',
  engineCompatibility: '>=1.0.0 <2.0.0',
  creator: { displayName: 'PLACEHOLDER' },
  defaultLocale: 'en',
  documents: ['regions/**'],
};

function makePack(files) {
  const root = mkdtempSync(join(tmpdir(), 'rw-content-'));
  const pack = join(root, 'pack-a');
  mkdirSync(pack);
  for (const [name, body] of Object.entries(files)) {
    const path = join(pack, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return { root, pack };
}

describe('discoverPacks', () => {
  it('finds directories containing a pack.json manifest', () => {
    const { root, pack } = makePack({ 'pack.json': VALID_MANIFEST });
    expect(discoverPacks(root)).toEqual([pack]);
  });

  it('returns no packs for a missing or empty content root', () => {
    expect(discoverPacks('/nonexistent-content-root')).toEqual([]);
  });
});

describe('validatePack', () => {
  it('accepts a well-formed pack with declared schemaType/schemaVersion documents', () => {
    const { pack } = makePack({
      'pack.json': VALID_MANIFEST,
      'regions/arrival.json': {
        schemaType: 'region',
        schemaVersion: '1.0',
        id: 'region.arrival',
      },
    });
    expect(validatePack(pack)).toEqual([]);
  });

  it('rejects malformed JSON with a diagnostic naming the document', () => {
    const { pack } = makePack({
      'pack.json': VALID_MANIFEST,
      'regions/broken.json': '{ not json',
    });
    const diagnostics = validatePack(pack);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].file).toContain('broken.json');
    expect(diagnostics[0].expected).toBe('well-formed JSON');
  });

  it('rejects a manifest missing required fields, naming each field (DATA-FR-001)', () => {
    const { pack } = makePack({ 'pack.json': { schemaType: 'pack' } });
    const missing = validatePack(pack).map((d) => d.path);
    expect(missing).toContain('id');
    expect(missing).toContain('engineCompatibility');
    expect(missing).toContain('defaultLocale');
  });

  it('rejects documents that do not declare schemaType and schemaVersion (DATA-FR-003)', () => {
    const { pack } = makePack({
      'pack.json': VALID_MANIFEST,
      'npcs/foreman.json': { id: 'npc.foreman' },
    });
    const paths = validatePack(pack).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['schemaType', 'schemaVersion']));
  });

  it('rejects non-namespaced ids (DATA-FR-008)', () => {
    const { pack } = makePack({
      'pack.json': VALID_MANIFEST,
      'npcs/foreman.json': { schemaType: 'npc', schemaVersion: '1.0', id: 'Foreman' },
    });
    const diagnostics = validatePack(pack);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].path).toBe('id');
    expect(diagnostics[0].got).toBe('Foreman');
  });
});

describe('validateContentRoot', () => {
  it('is green when no packs exist yet (the reference pack has its own issue)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'rw-empty-'));
    expect(validateContentRoot(empty)).toEqual({ packs: [], diagnostics: [] });
  });
});
