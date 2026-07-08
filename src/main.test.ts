import { describe, expect, it } from 'vitest';
import { loadPack } from './content';
import { bootBrowser } from './main';
import { packFilesFromBundle } from './app';

describe('entry point', () => {
  it('is a no-op in a host without a DOM', () => {
    // Importing ./main already executed its top-level boot; reaching this
    // line proves the import was harmless, and a direct call agrees.
    expect(bootBrowser()).toBeNull();
  });

  it('bundles a complete, valid content pack for the browser boot', () => {
    const files = packFilesFromBundle();
    expect(files.has('pack.json')).toBe(true);
    const graph = loadPack(files);
    expect(graph.entities.get(graph.startRegion)).toBeDefined();
  });
});
