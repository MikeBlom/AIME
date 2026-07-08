import { describe, expect, it } from 'vitest';
import { matchesGlob } from './glob.js';
import { compareVersions, isValidRange, parseVersion, satisfies } from './semver.js';

describe('semver subset (DATA-FR-016)', () => {
  it('parses and orders X.Y.Z versions', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2')).toBeNull();
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('evaluates comparator ranges', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '=1.2.3')).toBe(false);
    expect(satisfies('1.2.3', 'not-a-range')).toBe(false);
    expect(isValidRange('>=1.0.0 <2.0.0')).toBe(true);
    expect(isValidRange('one point oh')).toBe(false);
  });
});

describe('manifest globs (DATA-FR-001/002)', () => {
  it('matches literal paths, * within a segment, and ** across segments', () => {
    expect(matchesGlob('regions/arrival.json', 'regions/**')).toBe(true);
    expect(matchesGlob('strings/en/strings.json', 'strings/**')).toBe(true);
    expect(matchesGlob('strings/en/strings.json', 'strings/*/strings.json')).toBe(true);
    expect(matchesGlob('strings/en/extra/strings.json', 'strings/*/strings.json')).toBe(false);
    expect(matchesGlob('quests/one.json', 'quests/one.json')).toBe(true);
    expect(matchesGlob('notes/stray.json', 'regions/**')).toBe(false);
    expect(matchesGlob('regionsx/sneaky.json', 'regions/**')).toBe(false);
  });
});
