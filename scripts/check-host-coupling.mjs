/**
 * "Host coupling confined to the Platform Adapter" static check
 * (NFR-ARCH-004, issue #14 AC2).
 *
 * Scans engine source for host/platform API usage — DOM, timers, wall
 * clock, unseeded randomness, storage, network — everywhere EXCEPT
 * `src/platform/`, the one layer allowed to touch the host. Anything the
 * engine needs from the host must arrive through the adapter's narrow
 * interfaces (or, for time/randomness, Core's injected services), so
 * porting to a new host touches only that layer.
 *
 * Comments and string literals are stripped before matching, so prose that
 * *mentions* requestAnimationFrame does not trip the gate — only code that
 * calls it does. The denylist is data: extend it as new host APIs appear.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Host API identifiers that must not appear outside the adapter. */
export const DENYLIST = [
  { term: 'window', reason: 'DOM global' },
  { term: 'document', reason: 'DOM global' },
  { term: 'navigator', reason: 'DOM global' },
  { term: 'globalThis', reason: 'host global access' },
  { term: 'localStorage', reason: 'host storage; use the adapter KeyValueStorage' },
  { term: 'sessionStorage', reason: 'host storage; use the adapter KeyValueStorage' },
  { term: 'indexedDB', reason: 'host storage; use the adapter KeyValueStorage' },
  { term: 'requestAnimationFrame', reason: 'host timer; use the adapter TimerSource' },
  { term: 'cancelAnimationFrame', reason: 'host timer; use the adapter TimerSource' },
  { term: 'setTimeout', reason: 'host timer; use the scheduler/TimerSource' },
  { term: 'setInterval', reason: 'host timer; use the scheduler/TimerSource' },
  { term: 'performance', reason: 'wall clock; use the injected monotonic probe' },
  { term: 'Date', reason: 'wall clock; simulation time comes from TimeService (NFR-ARCH-001)' },
  { term: 'Math\\.random', reason: 'unseeded randomness; use RngService (NFR-ARCH-001)' },
  { term: 'fetch', reason: 'network; route through the adapter' },
  { term: 'XMLHttpRequest', reason: 'network; route through the adapter' },
  { term: 'WebSocket', reason: 'network; route through the adapter' },
  { term: 'AudioContext', reason: 'host audio; use the adapter AudioOutput' },
  { term: 'HTMLCanvasElement', reason: 'DOM type; render through the adapter RenderSurface' },
  { term: 'addEventListener', reason: 'DOM events; input arrives via the adapter InputDevice' },
];

/** Engine roots to scan and the adapter subtree exempt from the scan. */
export const SCAN_ROOTS = ['src'];
export const EXEMPT_DIRS = [join('src', 'platform')];

/** Test files may build fakes and probes; the gate governs engine code. */
const TEST_FILE = /\.test\.[cm]?[jt]s$/;

/**
 * Remove comments and string-literal contents so only code identifiers can
 * match. Line structure is preserved for accurate line numbers.
 */
export function stripCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | single | double | template
  // Open `${` interpolations: a `}` in code at depth > 0 resumes the template.
  let templateDepth = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        i += 2;
      } else if (ch === '/' && next === '*') {
        mode = 'block';
        i += 2;
      } else if (ch === "'") {
        mode = 'single';
        out += ch;
        i += 1;
      } else if (ch === '"') {
        mode = 'double';
        out += ch;
        i += 1;
      } else if (ch === '`') {
        mode = 'template';
        out += ch;
        i += 1;
      } else if (ch === '}' && templateDepth > 0) {
        templateDepth -= 1;
        mode = 'template';
        out += ch;
        i += 1;
      } else {
        out += ch;
        i += 1;
      }
    } else if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += ch;
      }
      i += 1;
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i += 2;
      } else {
        if (ch === '\n') out += ch;
        i += 1;
      }
    } else {
      // Inside a string: drop contents, honor escapes, keep newlines.
      if (ch === '\\') {
        i += 2;
      } else if (
        (mode === 'single' && ch === "'") ||
        (mode === 'double' && ch === '"') ||
        (mode === 'template' && ch === '`')
      ) {
        mode = 'code';
        out += ch;
        i += 1;
      } else if (mode === 'template' && ch === '$' && next === '{') {
        // Interpolation contents are code and must stay visible to the scan.
        templateDepth += 1;
        mode = 'code';
        out += '${';
        i += 2;
      } else {
        if (ch === '\n') out += ch;
        i += 1;
      }
    }
  }
  return out;
}

/** Return violations found in one source text: { term, reason, line, column }. */
export function checkText(text) {
  const violations = [];
  const lines = stripCommentsAndStrings(text).split('\n');
  for (const { term, reason } of DENYLIST) {
    const pattern = new RegExp(`(?<![\\w$.])${term}\\b`);
    lines.forEach((lineText, i) => {
      const match = pattern.exec(lineText);
      if (match !== null) {
        violations.push({
          term: term.replace('\\.', '.'),
          reason,
          line: i + 1,
          column: match.index + 1,
        });
      }
    });
  }
  return violations;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function isExempt(file) {
  return EXEMPT_DIRS.some((dir) => file === dir || file.startsWith(dir + sep));
}

/** Scan the given roots; returns { file, term, reason, line, column } items. */
export function scanRoots(roots) {
  const findings = [];
  for (const root of roots) {
    let files;
    try {
      files = walk(root);
    } catch {
      continue;
    }
    for (const file of files) {
      if (isExempt(file) || TEST_FILE.test(file)) continue;
      for (const v of checkText(readFileSync(file, 'utf8'))) {
        findings.push({ file, ...v });
      }
    }
  }
  return findings;
}

function main() {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : SCAN_ROOTS;
  const findings = scanRoots(roots);
  for (const f of findings) {
    console.error(
      `${relative('.', f.file)}:${f.line}:${f.column}: host API "${f.term}" (${f.reason}) — ` +
        `host coupling is confined to src/platform (NFR-ARCH-004)`,
    );
  }
  if (findings.length > 0) {
    console.error(`check-host-coupling: ${findings.length} violation(s).`);
    return 1;
  }
  console.warn(`check-host-coupling: clean (${roots.join(', ')}; src/platform exempt)`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.exitCode = main();
}
