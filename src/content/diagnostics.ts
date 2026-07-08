/**
 * Actionable validation diagnostics (DATA-FR-014): every finding names the
 * document, the field path, the expected shape, and the offending value
 * where safe to show, plus the requirement it enforces.
 */
import type { ComponentData } from '../core/entity-store.js';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /** Pack-relative document path, e.g. `quests/restore-power.json`. */
  readonly file: string;
  /** Field path within the document, e.g. `objectives[0].type`. */
  readonly path: string;
  /** What a valid value looks like. */
  readonly expected: string;
  /** The offending value, stringified where safe to show. */
  readonly got: ComponentData;
  readonly severity: Severity;
  /** The requirement this enforces, e.g. `DATA-FR-007`. */
  readonly rule: string;
}

/** Render one diagnostic as a single actionable line. */
export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}: ${d.path}: expected ${d.expected}, got ${JSON.stringify(d.got)} [${d.rule}]`;
}

/** True when any diagnostic is an error (warnings alone never block a load). */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
