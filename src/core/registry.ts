/**
 * Module registry, System interface, and plugins — how Core hosts behavior
 * without knowing what it does, from docs/02-System-Architecture.md
 * (FR-ARCH-005..008, FR-ARCH-017..020, FR-ARCH-026..027).
 *
 * Systems are self-contained modules with a defined lifecycle; they never
 * hold references to each other and coordinate only through the event bus
 * and shared world state (FR-ARCH-005). Plugins bundle Systems plus the
 * component and event types they introduce, added or removed as a unit
 * (FR-ARCH-018..019). The active module set comes from a declarative
 * manifest — data, not hardcoded wiring (FR-ARCH-017).
 *
 * Determinism: init/update order is a topological sort of declared
 * dependencies (FR-ARCH-026) with registration order as the stable tiebreak
 * (FR-ARCH-027); no wall clock, no randomness.
 */
import type { ComponentData, ComponentType, EntityStore } from './entity-store';
import type { EventPayload, EventType, EventBus } from './event-bus';
import type { InputSnapshotBoundary } from './runtime-loop';
import type { RngService } from './rng';
import type { TimeService } from './time';

/**
 * Schedules long-running work (asset loads, content parsing) off the
 * critical simulation path (FR-ARCH-028); results come back via events.
 * The concrete scheduler arrives with the runtime-loop issue — this is the
 * narrow face Systems are allowed to see.
 */
export interface Scheduler {
  schedule(task: () => void): void;
}

/**
 * The narrow platform interfaces (render surface, input, audio, timers,
 * storage) a System may touch. The Platform Adapter issue populates this;
 * keeping it an open record lets that layer grow without editing Core.
 */
export type PlatformInterfaces = Readonly<Record<string, unknown>>;

/**
 * The Context handed to every lifecycle call: world state, the event bus,
 * the scheduler, and platform interfaces. Systems receive everything they
 * may touch through it, so each is unit-testable with fakes (NFR-ARCH-002).
 */
export interface SystemContext {
  readonly world: EntityStore;
  readonly events: EventBus;
  readonly scheduler: Scheduler;
  readonly platform: PlatformInterfaces;
  /** Simulation time — Systems read this, never a wall clock (NFR-ARCH-001). */
  readonly time: TimeService;
  /** Seedable randomness — the only randomness simulation code may use (NFR-ARCH-001). */
  readonly rng: RngService;
  /** This frame's immutable input snapshot (FR-ARCH-023). */
  readonly input: InputSnapshotBoundary;
}

/**
 * The System interface (FR-ARCH-005..008): a unique stable id, declared
 * dependencies used for load ordering (FR-ARCH-006), and the
 * init/update/teardown lifecycle. `update` must be pure with respect to its
 * inputs; `teardown` must leave world state consistent for re-init
 * (hot-reload). A dependency names another System's id; a dependency that is
 * not registered is tolerated — the System degrades gracefully rather than
 * failing (FR-ARCH-008).
 */
export interface System {
  readonly id: string;
  readonly dependencies: readonly string[];
  init(context: SystemContext): void;
  update(dt: number, context: SystemContext): void;
  teardown(context: SystemContext): void;
}

/**
 * A plugin bundles Systems and the component/event types they introduce,
 * registered and removed as a unit (FR-ARCH-018..019). Plugin dependencies
 * name other plugin ids and are hard: a missing one fails the load loudly
 * and safely (FR-ARCH-020), unlike a System's soft ordering dependencies.
 */
export interface Plugin {
  readonly id: string;
  readonly dependencies?: readonly string[];
  readonly systems: readonly System[];
  readonly componentTypes?: readonly ComponentType<ComponentData>[];
  readonly eventTypes?: readonly EventType<EventPayload>[];
}

/** A registrable module: a lone System or a Plugin bundle. */
export type Module = System | Plugin;

/**
 * The declarative activation manifest (FR-ARCH-017): plain data naming which
 * catalog modules are active for this build or Content Pack. Being data, it
 * can ship inside a pack or a build config without touching Core.
 */
export interface RegistryManifest {
  readonly modules: readonly string[];
}

/** Plugins carry a `systems` array; lone Systems carry lifecycle functions. */
function isPlugin(module: Module): module is Plugin {
  return Array.isArray((module as Plugin).systems);
}

/**
 * Hosts Systems and plugins for Core: `register` admits a System or a
 * Plugin, `loadManifest` activates modules from data, and the computed
 * `order` drives `initAll`/`updateAll`/`teardownAll`. Core knows only this
 * contract — never what any System does.
 */
export class ModuleRegistry {
  #systems = new Map<string, System>();
  #plugins = new Map<string, Plugin>();
  #componentTypes = new Map<string, ComponentType<ComponentData>>();
  #eventTypes = new Map<string, EventType<EventPayload>>();
  /** Registration sequence per system id — the stable tiebreak (FR-ARCH-027). */
  #registrationIndex = new Map<string, number>();
  #registrationCounter = 0;
  #cachedOrder: readonly System[] | null = null;

  /**
   * Register a System or a Plugin (the `register(system|plugin)` contract).
   * A plugin's Systems, component types, and event types land as a unit
   * (FR-ARCH-018); duplicate ids fail loudly so independent plugins cannot
   * silently overwrite each other (FR-ARCH-019).
   */
  register(module: Module): void {
    if (isPlugin(module)) {
      this.#registerPlugin(module);
    } else {
      this.#registerSystem(module);
    }
    this.#cachedOrder = null;
  }

  /**
   * Activate modules from a declarative manifest (FR-ARCH-017): each named
   * id is looked up in `catalog` and registered. An id the catalog does not
   * know fails loudly — a manifest must never half-apply (FR-ARCH-030).
   */
  loadManifest(manifest: RegistryManifest, catalog: ReadonlyMap<string, Module>): void {
    const missing = manifest.modules.filter((id) => !catalog.has(id));
    if (missing.length > 0) {
      throw new Error(
        `manifest names unknown module(s) ${missing.map((id) => `"${id}"`).join(', ')}; ` +
          `known: ${[...catalog.keys()].map((id) => `"${id}"`).join(', ') || '(none)'}`,
      );
    }
    const repeated = manifest.modules.filter((id, index) => manifest.modules.indexOf(id) < index);
    if (repeated.length > 0) {
      throw new Error(
        `manifest names module(s) ${repeated.map((id) => `"${id}"`).join(', ')} more than once`,
      );
    }
    for (const id of manifest.modules) this.register(catalog.get(id) as Module);
  }

  /**
   * The computed init/update order (FR-ARCH-026..027): a topological sort of
   * declared System dependencies, ties broken by registration order. Missing
   * plugin dependencies and dependency cycles are rejected here, before any
   * lifecycle runs, so the runtime never starts half-wired (FR-ARCH-020).
   */
  get order(): readonly System[] {
    if (this.#cachedOrder === null) {
      this.#assertPluginDependencies();
      this.#cachedOrder = this.#topologicalOrder();
    }
    return this.#cachedOrder;
  }

  /** Component types registered so far, by id — plugins extend this freely (FR-ARCH-004). */
  get componentTypes(): ReadonlyMap<string, ComponentType<ComponentData>> {
    return this.#componentTypes;
  }

  /** Event types registered so far, by id — plugins extend this freely (FR-ARCH-018). */
  get eventTypes(): ReadonlyMap<string, EventType<EventPayload>> {
    return this.#eventTypes;
  }

  /** Run every System's `init` in dependency order. */
  initAll(context: SystemContext): void {
    for (const system of this.order) system.init(context);
  }

  /** Run every System's `update` in dependency order with the tick's `dt`. */
  updateAll(dt: number, context: SystemContext): void {
    for (const system of this.order) system.update(dt, context);
  }

  /** Run every System's `teardown` in reverse dependency order, so dependents release first. */
  teardownAll(context: SystemContext): void {
    for (const system of [...this.order].reverse()) system.teardown(context);
  }

  #registerSystem(system: System): void {
    if (this.#systems.has(system.id)) {
      throw new Error(`duplicate System id "${system.id}"; System ids must be unique and stable`);
    }
    this.#systems.set(system.id, system);
    this.#registrationIndex.set(system.id, this.#registrationCounter++);
  }

  #registerPlugin(plugin: Plugin): void {
    if (this.#plugins.has(plugin.id)) {
      throw new Error(`duplicate plugin id "${plugin.id}"; plugin ids must be unique and stable`);
    }
    // Validate the whole bundle before admitting any of it, so a bad plugin
    // is rejected as a unit and never half-applied (FR-ARCH-020).
    const bundleIds = new Set<string>();
    for (const system of plugin.systems) {
      if (this.#systems.has(system.id) || bundleIds.has(system.id)) {
        throw new Error(
          `plugin "${plugin.id}" redefines System id "${system.id}"; System ids must be unique`,
        );
      }
      bundleIds.add(system.id);
    }
    for (const type of plugin.componentTypes ?? []) {
      const known = this.#componentTypes.get(type.id);
      if (known !== undefined && known !== type) {
        throw new Error(
          `plugin "${plugin.id}" redefines component type id "${type.id}"; namespace plugin type ids`,
        );
      }
    }
    for (const type of plugin.eventTypes ?? []) {
      const known = this.#eventTypes.get(type.id);
      if (known !== undefined && known !== type) {
        throw new Error(
          `plugin "${plugin.id}" redefines event type id "${type.id}"; namespace plugin type ids`,
        );
      }
    }
    this.#plugins.set(plugin.id, plugin);
    for (const system of plugin.systems) this.#registerSystem(system);
    for (const type of plugin.componentTypes ?? []) this.#componentTypes.set(type.id, type);
    for (const type of plugin.eventTypes ?? []) this.#eventTypes.set(type.id, type);
  }

  /** Missing plugin dependencies fail loudly and safely (FR-ARCH-020). */
  #assertPluginDependencies(): void {
    for (const plugin of this.#plugins.values()) {
      for (const dependency of plugin.dependencies ?? []) {
        if (!this.#plugins.has(dependency)) {
          throw new Error(
            `plugin "${plugin.id}" depends on plugin "${dependency}", which is not registered; ` +
              `register "${dependency}" first or remove the dependency`,
          );
        }
      }
    }
  }

  /**
   * Kahn's algorithm over declared System dependencies (FR-ARCH-026).
   * Among ready Systems the lowest registration index runs first — the
   * stable, reproducible tiebreak (FR-ARCH-027). A dependency on an id that
   * is not registered is ignored for ordering: the System tolerates the
   * absent collaborator instead of failing (FR-ARCH-008).
   */
  #topologicalOrder(): readonly System[] {
    const pending = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const system of this.#systems.values()) {
      const present = system.dependencies.filter((id) => this.#systems.has(id));
      pending.set(system.id, present.length);
      for (const dependency of present) {
        const list = dependents.get(dependency) ?? [];
        list.push(system.id);
        dependents.set(dependency, list);
      }
    }
    const byRegistration = (a: string, b: string) =>
      (this.#registrationIndex.get(a) as number) - (this.#registrationIndex.get(b) as number);
    const ready = [...pending.keys()].filter((id) => pending.get(id) === 0).sort(byRegistration);
    const order: System[] = [];
    while (ready.length > 0) {
      const id = ready.shift() as string;
      order.push(this.#systems.get(id) as System);
      for (const dependent of dependents.get(id) ?? []) {
        const remaining = (pending.get(dependent) as number) - 1;
        pending.set(dependent, remaining);
        if (remaining === 0) {
          ready.push(dependent);
          ready.sort(byRegistration);
        }
      }
    }
    if (order.length < this.#systems.size) {
      throw new Error(`System dependency cycle detected: ${this.#findCycle()} (FR-ARCH-026)`);
    }
    return order;
  }

  /** Walk the dependency graph to name one concrete cycle for the diagnostic. */
  #findCycle(): string {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const path: string[] = [];
    const visit = (id: string): string | null => {
      if (done.has(id)) return null;
      if (visiting.has(id)) {
        const cycle = path.slice(path.indexOf(id));
        return [...cycle, id].map((step) => `"${step}"`).join(' -> ');
      }
      visiting.add(id);
      path.push(id);
      const system = this.#systems.get(id) as System;
      for (const dependency of system.dependencies) {
        if (!this.#systems.has(dependency)) continue;
        const found = visit(dependency);
        if (found !== null) return found;
      }
      path.pop();
      visiting.delete(id);
      done.add(id);
      return null;
    };
    for (const id of this.#systems.keys()) {
      const found = visit(id);
      if (found !== null) return found;
    }
    return '(cycle vanished during diagnosis; re-run order computation)';
  }
}
