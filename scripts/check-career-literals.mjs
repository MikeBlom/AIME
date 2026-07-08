/**
 * "No career literals in engine" static check (DATA-FR-027, NFR-ARCH-007).
 *
 * Scans engine source (`src/`) for creator/career-specific string literals.
 * The engine must hold zero career facts — everything creator-specific lives
 * in the content layer (`content/`), which is exactly the allowlist: it is
 * outside the scanned roots by design.
 *
 * The denylist is data: extend `DENYLIST` as real career content lands so the
 * engine seam stays enforced, not aspirational.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Case-insensitive creator/career terms that must never appear in engine code. */
export const DENYLIST = [
  { term: 'mike', reason: 'creator first name' },
  { term: 'blom', reason: 'creator family name' },
  { term: 'mikewblom', reason: 'creator email/handle' },
  { term: 'farmington', reason: 'creator location' },
  { term: 'linkedin', reason: 'career-site reference; the world is not a resume site' },
];

/** Engine roots to scan; the content layer is deliberately not listed. */
export const SCAN_ROOTS = ['src'];

/** Return violations found in one string: { term, reason, line, column }. */
export function checkText(text) {
  const violations = [];
  const lines = text.split('\n');
  for (const { term, reason } of DENYLIST) {
    const needle = term.toLowerCase();
    lines.forEach((lineText, i) => {
      const column = lineText.toLowerCase().indexOf(needle);
      if (column !== -1) {
        violations.push({ term, reason, line: i + 1, column: column + 1 });
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
      `${relative('.', f.file)}:${f.line}:${f.column}: career literal "${f.term}" (${f.reason}) — engine code holds zero career facts; move it to the content pack`,
    );
  }
  if (findings.length > 0) {
    console.error(`check-career-literals: ${findings.length} violation(s) in ${roots.join(', ')}`);
    return 1;
  }
  console.warn(`check-career-literals: clean (${roots.join(', ')})`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.exitCode = main();
}
