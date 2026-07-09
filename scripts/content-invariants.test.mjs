import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePack } from '../src/content/index.ts';
import { SCAN_ROOTS, scanRoots } from './check-career-literals.mjs';
import { discoverPacks, readPackFiles } from './validate-content.mjs';

// The content-invariant safety net (issue #43, docs/41-Testing-Strategy.md):
// the two hard seam invariants, asserted against the REAL repository on
// every test run so auto-merge can be trusted. checker unit tests prove the
// tools work on fixtures; this suite points them at what we actually ship —
// the engine source holds zero career facts (DATA-FR-027, NFR-ARCH-007) and
// every shipped Content Pack validates whole (DATA-FR-013, NFR-DATA-002).

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CONTENT_ROOT = join(REPO_ROOT, 'content');

describe('content invariants over the shipped repository (issue #43)', () => {
  it('the engine source holds zero career literals', () => {
    expect(scanRoots(SCAN_ROOTS.map((root) => join(REPO_ROOT, root)))).toEqual([]);
  });

  it('every shipped content pack validates with zero diagnostics', () => {
    const packs = discoverPacks(CONTENT_ROOT);
    // Discovery going blind would pass vacuously; the repo ships packs.
    expect(packs.length).toBeGreaterThanOrEqual(2);
    for (const packDir of packs) {
      const { diagnostics, graph } = validatePack(readPackFiles(packDir));
      expect(diagnostics, packDir).toEqual([]);
      expect(graph, packDir).not.toBeNull();
    }
  });
});
