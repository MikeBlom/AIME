/**
 * The bundled reference Content Pack, inlined at build time by the bundler
 * so the opening content needs no network round-trip (DATA-FR-019's
 * lightweight opening). Which pack directory to bundle is this one constant
 * — data the build reads, not engine logic (DATA-FR-028); the loader treats
 * the result exactly like files from any other source.
 */
import type { PackFiles } from '../content';

const PACK_ROOT = '/content/pack.reference/';

const RAW_FILES = import.meta.glob('/content/pack.reference/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The bundled pack as pack-relative path → raw JSON text. */
export function packFilesFromBundle(): PackFiles {
  const files = new Map<string, string>();
  for (const [path, text] of Object.entries(RAW_FILES)) {
    files.set(path.startsWith(PACK_ROOT) ? path.slice(PACK_ROOT.length) : path, text);
  }
  return files;
}
