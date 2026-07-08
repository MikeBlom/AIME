/**
 * Standalone content-pack validator (DATA-FR-013): validates every Content
 * Pack under `content/` offline, without launching the experience, so authors
 * and CI can block malformed content before it reaches a visitor
 * (NFR-DATA-002).
 *
 * A pack is any directory containing a `pack.json` manifest. Checks per
 * DATA-FR-001/003/008:
 *   - every `.json` document parses,
 *   - `pack.json` declares the minimum manifest fields,
 *   - every other document declares `schemaType` and `schemaVersion`,
 *   - declared `id`s use the namespaced `type.name` form.
 *
 * Diagnostics are actionable (DATA-FR-014): each names the document, the
 * field path, the expected shape, and the offending value.
 *
 * Per-type JSON Schemas and cross-document reference checks (DATA-FR-007/009/
 * 015) arrive with the content-loader issue; this validator is the CI seam
 * they plug into.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MANIFEST_NAME = 'pack.json';
const ID_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const MANIFEST_REQUIRED = [
  'schemaType',
  'schemaVersion',
  'id',
  'version',
  'engineCompatibility',
  'creator',
  'defaultLocale',
  'documents',
];

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
  return manifests.map((m) => m.slice(0, -(MANIFEST_NAME.length + 1)));
}

function diagnostic(file, path, expected, got) {
  return { file, path, expected, got };
}

function parseJson(file, diagnostics) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    diagnostics.push(diagnostic(file, '(document)', 'well-formed JSON', String(err.message)));
    return undefined;
  }
}

/** Validate one pack directory; returns a list of diagnostics (empty = valid). */
export function validatePack(packDir) {
  const diagnostics = [];

  const manifestFile = join(packDir, MANIFEST_NAME);
  const manifest = parseJson(manifestFile, diagnostics);
  if (manifest !== undefined) {
    for (const field of MANIFEST_REQUIRED) {
      if (manifest[field] === undefined) {
        diagnostics.push(
          diagnostic(manifestFile, field, 'required manifest field (DATA-FR-001)', 'missing'),
        );
      }
    }
    if (manifest.schemaType !== undefined && manifest.schemaType !== 'pack') {
      diagnostics.push(diagnostic(manifestFile, 'schemaType', "'pack'", manifest.schemaType));
    }
    if (manifest.documents !== undefined && !Array.isArray(manifest.documents)) {
      diagnostics.push(
        diagnostic(manifestFile, 'documents', 'array of documents or globs', manifest.documents),
      );
    }
  }

  for (const file of walk(packDir, (p) => p.endsWith('.json'))) {
    if (file === manifestFile) continue;
    const doc = parseJson(file, diagnostics);
    if (doc === undefined) continue;
    for (const field of ['schemaType', 'schemaVersion']) {
      if (typeof doc[field] !== 'string' || doc[field] === '') {
        diagnostics.push(diagnostic(file, field, 'non-empty string (DATA-FR-003)', doc[field]));
      }
    }
    if (doc.id !== undefined && !ID_PATTERN.test(String(doc.id))) {
      diagnostics.push(
        diagnostic(file, 'id', 'namespaced id like `type.name` (DATA-FR-008)', doc.id),
      );
    }
  }

  return diagnostics;
}

/** Validate every pack under `contentRoot`; returns { packs, diagnostics }. */
export function validateContentRoot(contentRoot) {
  const packs = discoverPacks(contentRoot);
  const diagnostics = packs.flatMap((pack) => validatePack(pack));
  return { packs, diagnostics };
}

function main() {
  const contentRoot = process.argv[2] ?? 'content';
  const { packs, diagnostics } = validateContentRoot(contentRoot);

  if (packs.length === 0) {
    console.warn(
      `validate-content: no packs under ${contentRoot}/ (the reference pack arrives with its own issue); nothing to validate.`,
    );
    return 0;
  }

  for (const d of diagnostics) {
    console.error(
      `${relative('.', d.file)}: ${d.path}: expected ${d.expected}, got ${JSON.stringify(d.got)}`,
    );
  }
  const packList = packs.map((p) => relative('.', p)).join(', ');
  if (diagnostics.length > 0) {
    console.error(`validate-content: ${diagnostics.length} error(s) across packs: ${packList}`);
    return 1;
  }
  console.warn(`validate-content: ${packs.length} pack(s) valid: ${packList}`);
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  process.exitCode = main();
}
