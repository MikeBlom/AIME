/**
 * Deep-freeze for plain, JSON-like engine data. Events (FR-ARCH-011) and
 * per-frame input snapshots (FR-ARCH-023) are immutable by contract; this is
 * the one shared enforcement point.
 */
import type { ComponentData } from './entity-store.js';

/** Recursively freeze a value so no consumer can mutate it. */
export function deepFreeze<T extends ComponentData>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child as ComponentData);
  }
  return value;
}
