/**
 * Structural document validation (DATA-FR-012/014): checks a parsed JSON
 * document against a published content schema and reports actionable,
 * field-level diagnostics.
 *
 * The schema dialect is a small, well-defined subset of JSON Schema — types,
 * `required`, `properties`, `items`, `enum`, `pattern`, and boolean
 * `additionalProperties` — which is all the content contract needs. Staying
 * dependency-free keeps the validator identical in CI (node) and at runtime
 * (browser), one source of truth for both (DATA-FR-013).
 */
import type { ComponentData } from '../core/entity-store.js';
import type { Diagnostic } from './diagnostics.js';

/** The JSON-Schema subset content schemas use. */
export interface ContentSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'boolean';
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, ContentSchema>>;
  readonly items?: ContentSchema;
  readonly enum?: readonly ComponentData[];
  readonly pattern?: string;
  readonly additionalProperties?: boolean;
  /** Human description used in diagnostics when a value mismatches. */
  readonly description?: string;
}

function typeOf(value: ComponentData): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Validate `value` against `schema`; returns diagnostics anchored at `file`
 * (empty when valid). `path` is the field path accumulated so far.
 */
export function validateAgainstSchema(
  value: ComponentData,
  schema: ContentSchema,
  file: string,
  path = '(document)',
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const fail = (expected: string, got: ComponentData, at = path) =>
    out.push({ file, path: at, expected, got, severity: 'error', rule: 'DATA-FR-012' });

  if (schema.type !== undefined && typeOf(value) !== schema.type) {
    fail(schema.description ?? schema.type, value);
    return out; // wrong shape: deeper checks would only cascade noise
  }
  if (schema.enum !== undefined && !schema.enum.some((allowed) => allowed === value)) {
    fail(`one of ${JSON.stringify(schema.enum)}`, value);
  }
  if (schema.pattern !== undefined && typeof value === 'string') {
    if (!new RegExp(schema.pattern).test(value)) {
      fail(schema.description ?? `string matching ${schema.pattern}`, value);
    }
  }
  if (schema.type === 'object' && typeOf(value) === 'object') {
    const record = value as Readonly<Record<string, ComponentData>>;
    for (const key of schema.required ?? []) {
      if (record[key] === undefined) {
        fail('required field (DATA-FR-001/003)', 'missing', join(path, key));
      }
    }
    for (const [key, child] of Object.entries(record)) {
      const childSchema = schema.properties?.[key];
      if (childSchema !== undefined) {
        out.push(...validateAgainstSchema(child, childSchema, file, join(path, key)));
      } else if (schema.additionalProperties === false) {
        fail(`no field beyond ${JSON.stringify(Object.keys(schema.properties ?? {}))}`, key, path);
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      out.push(
        ...validateAgainstSchema(item, schema.items as ContentSchema, file, `${path}[${index}]`),
      );
    });
  }
  return out;
}

function join(path: string, key: string): string {
  return path === '(document)' ? key : `${path}.${key}`;
}
