/**
 * "No color literals outside the style layer" gate (issue #36 AC2;
 * FR-ART-001 in docs/12-Art-Direction.md).
 *
 * Every color the engine draws must resolve from the theme table in
 * `src/style/` by named role; a hex or literal-channel rgb()/rgba() string
 * anywhere else in engine source is style hardcoded per screen — exactly
 * what the art-direction pass removes. Test files are exempt (they pin
 * expected draw output); prose is not, so name the role, not the value.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const EXEMPT_DIR = join(SRC, 'style') + sep;
const TEST_FILE = /\.test\.[cm]?[jt]s$/;

/** A hex color in a string, or an rgb()/rgba() call with literal channels. */
const COLOR_LITERAL = /['"`]#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (path.endsWith('.ts') && !TEST_FILE.test(path)) files.push(path);
  }
  return files;
}

describe('color literals stay in src/style (FR-ART-001)', () => {
  const files = walk(SRC).filter((file) => !file.startsWith(EXEMPT_DIR));

  it('scans a plausible engine tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds no color literal outside the style layer', () => {
    const findings = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => COLOR_LITERAL.test(line))
        .map(({ line, number }) => `${relative(ROOT, file)}:${number} ${line}`),
    );
    expect(findings).toEqual([]);
  });

  it('the pattern catches the shapes it exists to catch', () => {
    for (const bad of [
      "const c = '#7ec8ff';",
      'clear("#06080c")',
      'fill(`#abc`)',
      "tint = 'rgba(10, 14, 34, 0.35)'",
      'rgb(1, 2, 3)',
    ]) {
      expect(COLOR_LITERAL.test(bad), bad).toBe(true);
    }
    for (const good of [
      'const c = THEME.palette.accent;',
      'render.fillRect(x, y, w, h, color)',
      // Composing alpha onto a theme rgb triplet is referencing, not hardcoding.
      'render.fillRect(0, 0, w, h, `rgba(${TRANSITION_RGB}, ${alpha})`)',
      'issue #36',
    ]) {
      expect(COLOR_LITERAL.test(good), good).toBe(false);
    }
  });
});
