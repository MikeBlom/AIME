import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCAN_ROOTS, checkText, scanRoots } from './check-career-literals.mjs';

describe('checkText', () => {
  it('flags creator-identity literals case-insensitively with line and column', () => {
    const violations = checkText('const a = 1;\nconst who = "M' + 'ike";\n');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ line: 2, column: 14 });
  });

  it('passes engine-flavored text that holds no career facts', () => {
    const clean = 'emit("SystemRestored"); // resume the simulation after pause';
    expect(checkText(clean)).toEqual([]);
  });
});

describe('scanRoots', () => {
  it('reports file, position, term, and reason for a seeded violation', () => {
    const root = mkdtempSync(join(tmpdir(), 'rw-engine-'));
    mkdirSync(join(root, 'core'));
    writeFileSync(join(root, 'core', 'bad.ts'), 'export const OWNER = "b' + 'lom";\n');
    const findings = scanRoots([root]);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain('bad.ts');
    expect(findings[0].reason).toContain('creator');
  });

  it('skips roots that do not exist', () => {
    expect(scanRoots(['/nonexistent-engine-root'])).toEqual([]);
  });

  it('finds zero career literals in the real engine source', () => {
    expect(scanRoots(SCAN_ROOTS)).toEqual([]);
  });
});
