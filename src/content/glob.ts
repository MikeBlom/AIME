/**
 * Minimal glob matching for manifest document discovery (DATA-FR-001/002).
 * Supports exactly what pack manifests need: literal paths, `*` within one
 * path segment (e.g. `strings/<star>/strings.json`), and `**` spanning
 * segments (`regions/**`).
 */

function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] as string;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i += 1;
      } else {
        pattern += '[^/]*';
      }
    } else {
      pattern += /[a-zA-Z0-9]/.test(ch) || ch === '/' ? ch : `\\${ch}`;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** True when the pack-relative `path` matches the manifest `glob`. */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

/** True when `path` matches any of the manifest `globs`. */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
