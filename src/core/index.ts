/**
 * Core — world state container, entity/component store, event bus, module
 * registry, scheduler, and the main loop. Core knows nothing about what
 * Systems do, only how to host them. Holds zero career facts.
 * See docs/02-System-Architecture.md, "Architectural Layers".
 *
 * Implementations arrive with the core-* issues; the entity/component store
 * is the first (#8), the rest still anchor here as placeholders.
 */
export const LAYER = 'core';

export { EntityStore, defineComponentType } from './entity-store';
export type { ComponentData, ComponentType, EntityId } from './entity-store';

export { ModuleRegistry } from './registry';
export type {
  Module,
  Plugin,
  PlatformInterfaces,
  RegistryManifest,
  Scheduler,
  System,
  SystemContext,
} from './registry';

export { RuntimeLoop } from './runtime-loop';
export type {
  ContextSeed,
  FrameTicker,
  InputSnapshotBoundary,
  Recording,
  RuntimeLoopOptions,
  SystemFault,
  SystemTiming,
} from './runtime-loop';

export { TimeService } from './time';
export { RngService } from './rng';
export { deepFreeze } from './freeze';

export { EventBus, defineEventType } from './event-bus';
export type {
  Delivery,
  EventHandler,
  EventLogEntry,
  EventPayload,
  EventRecord,
  EventType,
} from './event-bus';
