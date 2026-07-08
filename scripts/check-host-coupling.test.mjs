import { describe, expect, it } from 'vitest';
import {
  EXEMPT_DIRS,
  SCAN_ROOTS,
  checkText,
  scanRoots,
  stripCommentsAndStrings,
} from './check-host-coupling.mjs';

describe('stripCommentsAndStrings', () => {
  it('drops line and block comments, preserving line numbers', () => {
    const source = 'a // requestAnimationFrame\n/* window\n document */\nb';
    expect(stripCommentsAndStrings(source)).toBe('a \n\n\nb');
  });

  it('drops string contents but keeps interpolation code visible', () => {
    const source = "const s = 'window' + `document ${navigator} document`;";
    const stripped = stripCommentsAndStrings(source);
    expect(stripped).not.toContain('window');
    expect(stripped).toContain('navigator');
    expect(stripped.match(/document/g)).toBeNull();
  });

  it('handles a template nested inside an interpolation (registry.ts shape)', () => {
    const source = 'const s = `ids ${list.map((id) => `"${id}"`).join(", ")} tail window`;\nafter';
    const stripped = stripCommentsAndStrings(source);
    expect(stripped).not.toContain('window'); // template text stays hidden
    expect(stripped).toContain('list.map'); // interpolation code stays visible
    expect(stripped).toContain('after'); // scanner exits the template cleanly
  });
});

describe('checkText', () => {
  it('flags host API identifiers with line and column', () => {
    const violations = checkText('const t = 0;\nrequestAnimationFrame(step);');
    expect(violations).toContainEqual({
      term: 'requestAnimationFrame',
      reason: expect.stringContaining('TimerSource'),
      line: 2,
      column: 1,
    });
  });

  it('flags wall-clock and unseeded-randomness escapes (NFR-ARCH-001)', () => {
    expect(checkText('const t = Date.now();').map((v) => v.term)).toContain('Date');
    expect(checkText('const r = Math.random();').map((v) => v.term)).toContain('Math.random');
  });

  it('does not flag mentions in comments or strings, or identifier substrings', () => {
    expect(checkText('// uses requestAnimationFrame under the hood')).toEqual([]);
    expect(checkText("const label = 'window';")).toEqual([]);
    expect(checkText('const validate = 1; const windowed = 2;')).toEqual([]);
    expect(checkText('thing.window = 1;')).toEqual([]); // member access, not the global
  });
});

describe('scanRoots (AC2, NFR-ARCH-004)', () => {
  it('the engine tree is clean: no host calls outside src/platform', () => {
    expect(scanRoots(SCAN_ROOTS)).toEqual([]);
  });

  it('the adapter itself is exempt — host APIs live there by design', () => {
    expect(EXEMPT_DIRS).toContain('src/platform');
    // The browser backend really does use host APIs; if the exemption ever
    // broke, the previous assertion would fail loudly.
    expect(checkText("window.addEventListener('keydown', onKeyDown);").length).toBeGreaterThan(0);
  });
});
