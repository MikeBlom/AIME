import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverPacks, readPackFiles } from './validate-content.mjs';

// The validation logic itself lives in src/content (see loader.test.ts);
// this suite covers the CLI's filesystem adapter: pack discovery and
// reading a pack directory into the pipeline's pack-relative files map.

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
    const { root, pack } = makePack({ 'pack.json': { schemaType: 'pack' } });
    expect(discoverPacks(root)).toEqual([pack]);
  });

  it('returns no packs for a missing or empty content root', () => {
    expect(discoverPacks('/nonexistent-content-root')).toEqual([]);
  });
});

describe('readPackFiles', () => {
  it('reads every .json file into a sorted, pack-relative files map', () => {
    const { pack } = makePack({
      'pack.json': { schemaType: 'pack' },
      'regions/arrival.json': { schemaType: 'region' },
      'strings/en/strings.json': { schemaType: 'strings' },
      'notes.txt': 'not json, not read',
    });
    const files = readPackFiles(pack);
    expect([...files.keys()]).toEqual([
      'pack.json',
      'regions/arrival.json',
      'strings/en/strings.json',
    ]);
    expect(JSON.parse(files.get('pack.json'))).toEqual({ schemaType: 'pack' });
  });
});
