import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bootWorld } from '../src/app/index.ts';
import { validatePack } from '../src/content/index.ts';
import { createHeadlessPlatform } from '../src/platform/index.ts';
import { LOCALE_STRINGS, QUEST, REGION } from '../src/systems/index.ts';
import { readPackFiles } from './validate-content.mjs';

// Pack-swap conformance (issue #35 AC3, DATA-FR-029): a second placeholder
// pack — a different creator's world — must validate and boot on the SAME
// engine build, producing a coherent, visibly different world with zero
// code changes. Both packs go through the identical bootWorld call; only
// the pack files differ.

const CONTENT_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'content');

function bootPack(packDir) {
  const platform = createHeadlessPlatform({ width: 640, height: 360 });
  const handle = bootWorld({
    platform,
    packFiles: readPackFiles(join(CONTENT_ROOT, packDir)),
    seed: 5,
  });
  return { platform, handle };
}

describe('content pack swap (issue #35 AC3, DATA-FR-029)', () => {
  it('both shipped packs validate with zero errors', () => {
    for (const packDir of ['pack.reference', 'pack.harbor']) {
      const { diagnostics, graph } = validatePack(readPackFiles(join(CONTENT_ROOT, packDir)));
      expect(diagnostics, packDir).toEqual([]);
      expect(graph, packDir).not.toBeNull();
    }
  });

  it('the same engine build boots either pack into a coherent, different world', () => {
    const reference = bootPack('pack.reference');
    const harbor = bootPack('pack.harbor');

    // Different identity, different entry point.
    expect(harbor.handle.graph.packId).toBe('pack.harbor');
    expect(reference.handle.graph.packId).toBe('pack.reference');
    expect(harbor.handle.graph.startRegion).toBe('region.harbor');
    expect(harbor.handle.graph.startRegion).not.toBe(reference.handle.graph.startRegion);

    for (const { handle } of [reference, harbor]) {
      // Each world is coherent: a spawned start region, a player, and at
      // least one quest with its bypass-carrying definition.
      const [region] = handle.world.query(REGION);
      expect(handle.world.getComponent(region, REGION)?.contentId).toBe(handle.graph.startRegion);
      expect(handle.world.query(QUEST).length).toBeGreaterThan(0);
    }

    // The worlds tell different stories: disjoint quest ids, different
    // player-visible strings resolved from each pack's own locale table.
    const questIds = (handle) =>
      handle.world.query(QUEST).map((entity) => handle.world.getComponent(entity, QUEST)?.questId);
    const referenceQuests = questIds(reference.handle);
    const harborQuests = questIds(harbor.handle);
    expect(harborQuests).toEqual(['quest.light-the-beacon']);
    for (const id of harborQuests) expect(referenceQuests).not.toContain(id);

    const stringsOf = (handle) => {
      const [entity] = handle.world.query(LOCALE_STRINGS);
      return handle.world.getComponent(entity, LOCALE_STRINGS)?.entries ?? {};
    };
    const harborStrings = stringsOf(harbor.handle);
    expect(harborStrings['region.harbor.name']).toBeDefined();
    expect(stringsOf(reference.handle)['region.harbor.name']).toBeUndefined();

    // Both render a first frame: the swap yields a playable world, not
    // merely a loadable graph.
    for (const { platform, handle } of [reference, harbor]) {
      const stop = handle.start();
      platform.timers.tick(1 / 60);
      stop();
      expect(platform.render.commands.length).toBeGreaterThan(0);
    }
  });
});
