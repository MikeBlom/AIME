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

  it('ships the full arc: regions, NPCs, and quests, every quest with a bypass (issue #35)', () => {
    const { graph } = loadReferencePack();
    expect(graph?.byType.get('region')?.size).toBe(3);
    expect(graph?.byType.get('npc')?.size).toBe(3);
    expect(graph?.byType.get('quest')?.size).toBe(3);
    expect(graph?.byType.get('building')?.size).toBe(3);
    expect(graph?.byType.get('achievement')?.size).toBe(4);

    for (const quest of graph?.byType.get('quest')?.values() ?? []) {
      const bypass = quest.doc['bypass'];
      // FR-VIS-010: a player who cannot solve any puzzle still gets its meaning.
      expect(bypass, quest.id).toMatchObject({ allowed: true });
      expect(typeof bypass?.['revealsKey'], quest.id).toBe('string');
    }
  });

  it('binds each quest to a distinct catalog mechanic through its metaphor (issue #35)', () => {
    const { graph } = loadReferencePack();
    const mechanics = [];
    for (const quest of graph?.byType.get('quest')?.values() ?? []) {
      const metaphorRef = quest.doc['metaphorRef'];
      expect(typeof metaphorRef, quest.id).toBe('string');
      const metaphor = graph?.byType.get('metaphor')?.get(metaphorRef);
      expect(metaphor, `${quest.id} -> ${metaphorRef}`).toBeDefined();
      mechanics.push(metaphor?.doc['mechanic']);
    }
    expect([...mechanics].sort()).toEqual([
      'engine.mechanic.assembly',
      'engine.mechanic.orchestrate',
      'engine.mechanic.route-and-balance',
    ]);
  });

  it('carries the short-visit path: the start region contains every quest (FR-VIS-008)', () => {
    const { graph } = loadReferencePack();
    const start = graph?.byType.get('region')?.get(graph.startRegion);
    const quests = start?.doc['contains']?.['quests'] ?? [];
    // The headliner comes first; depth sits behind it, never in front.
    expect(quests[0]).toBe('quest.restore-power');
    expect([...quests].sort()).toEqual([
      'quest.conduct-the-yard',
      'quest.rebuild-the-line',
      'quest.restore-power',
    ]);
  });

  it('wires every dialogue resolve hook to a real quest objective (issue #35)', () => {
    const { graph } = loadReferencePack();
    const resolvesOf = (record) =>
      record !== null && typeof record === 'object' ? record['resolves'] : undefined;
    let hooks = 0;
    for (const dialogue of graph?.byType.get('dialogue')?.values() ?? []) {
      for (const node of dialogue.doc['nodes'] ?? []) {
        for (const hook of [resolvesOf(node), ...(node['choices'] ?? []).map(resolvesOf)]) {
          if (hook === undefined) continue;
          hooks += 1;
          const quest = graph?.byType.get('quest')?.get(hook['questRef']);
          expect(quest, `${dialogue.id} -> ${hook['questRef']}`).toBeDefined();
          const objectiveIds = (quest?.doc['objectives'] ?? []).map((objective) => objective['id']);
          expect(objectiveIds, `${dialogue.id} -> ${hook['questRef']}`).toContain(
            hook['objectiveId'],
          );
        }
      }
    }
    // Every quest offers both the in-fiction solve and the in-fiction bypass.
    expect(hooks).toBe(6);
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
