/**
 * Standalone content-pack validator CLI (DATA-FR-013): validates every
 * Content Pack under `content/` offline, without launching the experience,
 * so authors and CI block malformed content before it reaches a visitor
 * (NFR-DATA-002).
 *
 * This is a thin filesystem adapter over the engine's content pipeline
 * (`src/content`, compiled to `dist-content/` by `tsconfig.content.json`),
 * so CI and the runtime validate with one implementation and one set of
 * published schemas. Run via `npm run validate:content`, which builds the
 * pipeline first. Usage: `node scripts/validate-content.mjs [contentRoot]`.
 *
 * Exit codes: 0 = every pack valid (warnings allowed), 1 = any error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MANIFEST_NAME = 'pack.json';

/** Recursively list files under `dir` for which `keep(path)` is true. */
function walk(dir, keep) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** Find pack roots (directories containing a manifest) under `contentRoot`. */
export function discoverPacks(contentRoot) {
  let manifests;
  try {
    manifests = walk(contentRoot, (p) => p.endsWith(`/${MANIFEST_NAME}`));
  } catch {
    return [];
  }
  return manifests.map((m) => m.slice(0, -(MANIFEST_NAME.length + 1))).sort();
}

/** Read one pack directory into the pipeline's pack-relative files map. */
export function readPackFiles(packDir) {
  const files = new Map();
  for (const path of walk(packDir, (p) => p.endsWith('.json')).sort()) {
    files.set(relative(packDir, path), readFileSync(path, 'utf8'));
  }
  return files;
}

async function main() {
  // Lazy import so this module loads (for tests) before the pipeline builds.
  const { formatDiagnostic, validatePack } = await import('../dist-content/content/index.js');
  const contentRoot = process.argv[2] ?? 'content';
  const packs = discoverPacks(contentRoot);

  if (packs.length === 0) {
    console.warn(`validate-content: no packs under ${contentRoot}/; nothing to validate.`);
    return 0;
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const packDir of packs) {
    const { diagnostics, graph } = validatePack(readPackFiles(packDir));
    for (const d of diagnostics) {
      const line = `${relative('.', packDir)}/${formatDiagnostic(d)}`;
      if (d.severity === 'error') {
        errorCount += 1;
        console.error(`error: ${line}`);
      } else {
        warningCount += 1;
        console.warn(`warning: ${line}`);
      }
    }
    if (graph !== null) {
      console.warn(
        `validate-content: ${relative('.', packDir)} valid — ${graph.entities.size} entities, ` +
          `${graph.strings.size} locale(s), start region "${graph.startRegion}".`,
      );
    }
  }

  if (errorCount > 0) {
    console.error(
      `validate-content: ${errorCount} error(s), ${warningCount} warning(s) across ${packs.length} pack(s).`,
    );
    return 1;
  }
  console.warn(
    `validate-content: ${packs.length} pack(s) valid, ${warningCount} warning(s) (DATA-FR-013).`,
  );
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.exitCode = await main();
}
