/**
 * Content pipeline — the engine/content contract (DATA-FR-001..020): pack
 * validation, reference resolution, and the immutable content graph. Pure
 * and host-agnostic: the CI validator feeds it from the filesystem, the
 * runtime from fetch. Holds zero career facts; packs hold zero behavior.
 */
export { ENGINE_VERSION, MANIFEST_PATH, PackLoadError, loadPack, validatePack } from './loader.js';
export type {
  LoadPackOptions,
  PackFiles,
  ResolvedContentGraph,
  ResolvedEntity,
  ValidatePackResult,
} from './loader.js';

export {
  CONTENT_SCHEMAS,
  ENGINE_MECHANIC_PARAMS,
  ENGINE_MECHANICS,
  ID_PATTERN,
} from './schemas.js';
export type { ContentTypeSpec, ExtractedKey, ExtractedRef } from './schemas.js';

export { validateAgainstSchema } from './schema-validator.js';
export type { ContentSchema } from './schema-validator.js';

export { formatDiagnostic, hasErrors } from './diagnostics.js';
export type { Diagnostic, Severity } from './diagnostics.js';

export { compareVersions, isValidRange, parseVersion, satisfies } from './semver.js';
export { matchesAnyGlob, matchesGlob } from './glob.js';
