import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_SCHEMAS, ID_PATTERN, validatePack } from '../src/content/index.ts';
import { readPackFiles } from './validate-content.mjs';

// Conformance suite for the shipped minimal reference pack (#13): the pack
// under content/pack.reference must load through the real pipeline exactly as
// CI's validate:content gate sees it. loader.test.ts proves the pipeline with
// in-memory fixtures; this suite proves the pack we actually ship.

const PACK_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  'content',
  'pack.reference',
);

function loadReferencePack() {
  return validatePack(readPackFiles(PACK_DIR));
}

describe('minimal reference pack (issue #13)', () => {
  it('passes the standalone validator with zero errors (AC1, DATA-FR-013)', () => {
    const { diagnostics, graph } = loadReferencePack();
    // Zero errors is the acceptance bar; the shipped pack also carries zero
    // warnings today, and keeping it that way keeps the gate output clean.
    expect(diagnostics).toEqual([]);
    expect(graph).not.toBeNull();
  });

  it('defines entry.startRegion resolving to a shipped region (interface contract)', () => {
    const { graph } = loadReferencePack();
    expect(graph?.startRegion).toBe('region.arrival');
    expect(graph?.byType.get('region')?.has('region.arrival')).toBe(true);
  });

  it('ships one region, one NPC, and one quest with a bypass block (deliverables)', () => {
    const { graph } = loadReferencePack();
    expect(graph?.byType.get('region')?.size).toBe(1);
    expect(graph?.byType.get('npc')?.size).toBe(1);
    expect(graph?.byType.get('quest')?.size).toBe(1);

    const [quest] = graph?.byType.get('quest')?.values() ?? [];
    const bypass = quest?.doc['bypass'];
    // FR-VIS-010: a player who cannot solve the puzzle still gets the meaning.
    expect(bypass).toMatchObject({ allowed: true });
    expect(typeof bypass?.['revealsKey']).toBe('string');
  });

  it('resolves every player-visible string via a default-locale key (AC2, DATA-FR-011)', () => {
    const { graph } = loadReferencePack();
    const en = graph?.strings.get('en');
    expect(en).toBeDefined();

    const keyPattern = new RegExp(ID_PATTERN);
    let extracted = 0;
    for (const entity of graph?.entities.values() ?? []) {
      for (const { path, key } of CONTENT_SCHEMAS.get(entity.schemaType)?.keys?.(entity.doc) ??
        []) {
        extracted += 1;
        expect(key, `${entity.id} ${path}`).toMatch(keyPattern);
        expect(en?.has(key), `${entity.id} ${path} -> ${key}`).toBe(true);
      }
    }
    // The pack exercises the key extractors, not just documents without text.
    expect(extracted).toBeGreaterThan(0);
  });
});
