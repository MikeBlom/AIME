/**
 * Minimal semantic-version comparison for engine-compatibility checks
 * (DATA-FR-016). Supports `X.Y.Z` versions and ranges of space-separated
 * comparators (`>=1.0.0 <2.0.0`, `=1.2.3`, `1.2.3`). Deliberately tiny: the
 * manifest contract only needs comparator ranges, not full npm range syntax.
 */

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const COMPARATOR_RE = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/;

/** Parse `X.Y.Z` into numeric parts; null when malformed. */
export function parseVersion(version: string): readonly [number, number, number] | null {
  const m = VERSION_RE.exec(version);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Standard semver ordering: negative, zero, or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) {
    throw new Error(`compareVersions requires X.Y.Z versions, got "${a}" and "${b}"`);
  }
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] as number) - (pb[i] as number);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when a range string is well-formed for `satisfies`. */
export function isValidRange(range: string): boolean {
  const parts = range.trim().split(/\s+/);
  return parts.length > 0 && parts.every((part) => COMPARATOR_RE.test(part));
}

/** True when `version` satisfies every comparator in `range`. */
export function satisfies(version: string, range: string): boolean {
  if (parseVersion(version) === null || !isValidRange(range)) return false;
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const m = COMPARATOR_RE.exec(part) as RegExpExecArray;
      const operator = m[1] ?? '=';
      const bound = m[2] as string;
      const cmp = compareVersions(version, bound);
      switch (operator) {
        case '>=':
          return cmp >= 0;
        case '<=':
          return cmp <= 0;
        case '>':
          return cmp > 0;
        case '<':
          return cmp < 0;
        default:
          return cmp === 0;
      }
    });
}
