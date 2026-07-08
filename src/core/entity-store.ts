/**
 * Entity/component store — the composition substrate from
 * docs/02-System-Architecture.md (FR-ARCH-001..004).
 *
 * Entities are stable, serializable ids with components attached; components
 * are plain data; Systems gain behavior by querying composition. The store
 * hosts component types it has never heard of (FR-ARCH-004): plugins define
 * their own types with `defineComponentType` and never edit this file.
 *
 * Determinism: ids come from a per-store monotonic counter (no randomness,
 * no wall clock), and query iteration order is reproducible for the same
 * operation sequence.
 */

declare const entityIdBrand: unique symbol;

/**
 * Stable entity identity (FR-ARCH-001). A branded number at compile time and
 * a plain JSON-serializable number at runtime, so save/load can persist it.
 */
export type EntityId = number & { readonly [entityIdBrand]: 'EntityId' };

/**
 * The shape all component values must satisfy: plain, JSON-like data with no
 * functions (FR-ARCH-002). Logic lives in Systems, never in components.
 */
export type ComponentData =
  | string
  | number
  | boolean
  | null
  | readonly ComponentData[]
  | { readonly [key: string]: ComponentData };

/**
 * A component type descriptor: a stable string id carrying the value type.
 * Descriptors are created with `defineComponentType`, by core code and
 * plugins alike — the store treats both identically (FR-ARCH-004).
 */
export interface ComponentType<T extends ComponentData> {
  readonly id: string;
  /** Phantom marker binding T to the descriptor; never set at runtime. */
  readonly __value?: T;
}

/**
 * Define a component type. `id` should be namespaced (`position`,
 * `plugin-name.fuel-level`) so independent plugins cannot collide silently;
 * the store rejects two distinct descriptors sharing one id.
 */
export function defineComponentType<T extends ComponentData>(id: string): ComponentType<T> {
  return { id };
}

/** Entity/component store with composition queries (FR-ARCH-003). */
export class EntityStore {
  #nextId = 1;
  #entities = new Set<EntityId>();
  /** Component values per type id, keyed by entity. Insertion order is the deterministic iteration order. */
  #columns = new Map<string, Map<EntityId, ComponentData>>();
  /** First descriptor seen per type id, to fail loudly on id collisions. */
  #typesById = new Map<string, ComponentType<ComponentData>>();

  /** Create a new entity with a session-stable, serializable id (FR-ARCH-001). */
  createEntity(): EntityId {
    const id = this.#nextId++ as EntityId;
    this.#entities.add(id);
    return id;
  }

  /** Attach (or replace) a component on an entity. */
  addComponent<T extends ComponentData>(entity: EntityId, type: ComponentType<T>, value: T): void {
    this.#assertEntity(entity, 'addComponent');
    this.#column(type).set(entity, value);
  }

  /** Detach a component; a no-op when the entity does not carry it. */
  removeComponent(entity: EntityId, type: ComponentType<ComponentData>): void {
    this.#assertEntity(entity, 'removeComponent');
    this.#column(type).delete(entity);
  }

  /** Read a component's value, or undefined when the entity does not carry it. */
  getComponent<T extends ComponentData>(entity: EntityId, type: ComponentType<T>): T | undefined {
    this.#assertEntity(entity, 'getComponent');
    return this.#column(type).get(entity) as T | undefined;
  }

  /** True when the entity carries the component. */
  hasComponent(entity: EntityId, type: ComponentType<ComponentData>): boolean {
    this.#assertEntity(entity, 'hasComponent');
    return this.#column(type).has(entity);
  }

  /**
   * Composition query (FR-ARCH-003): exactly the entities carrying every
   * requested component type, in a deterministic order. Scans the smallest
   * column and probes the rest, so Systems iterate only what concerns them.
   */
  query(
    ...types: readonly [ComponentType<ComponentData>, ...ComponentType<ComponentData>[]]
  ): EntityId[] {
    let smallest = this.#column(types[0]);
    const rest: Map<EntityId, ComponentData>[] = [];
    for (const type of types.slice(1)) {
      const column = this.#column(type);
      if (column.size < smallest.size) {
        rest.push(smallest);
        smallest = column;
      } else {
        rest.push(column);
      }
    }
    const result: EntityId[] = [];
    for (const entity of smallest.keys()) {
      if (rest.every((column) => column.has(entity))) result.push(entity);
    }
    return result;
  }

  #assertEntity(entity: EntityId, operation: string): void {
    if (!this.#entities.has(entity)) {
      throw new Error(`${operation}: unknown entity id ${entity}; ids come from createEntity()`);
    }
  }

  #column(type: ComponentType<ComponentData>): Map<EntityId, ComponentData> {
    const known = this.#typesById.get(type.id);
    if (known === undefined) {
      this.#typesById.set(type.id, type);
    } else if (known !== type) {
      throw new Error(
        `duplicate component type id "${type.id}": two distinct descriptors share one id; namespace plugin component ids`,
      );
    }
    let column = this.#columns.get(type.id);
    if (column === undefined) {
      column = new Map();
      this.#columns.set(type.id, column);
    }
    return column;
  }
}
