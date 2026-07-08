import { describe, expect, it } from 'vitest';
import { EntityStore, defineComponentType } from './entity-store';
import type { ComponentData, EntityId } from './entity-store';

const Position = defineComponentType<{ x: number; y: number }>('position');
const Renderable = defineComponentType<{ assetRef: string }>('renderable');
const Interactable = defineComponentType<boolean>('interactable');

describe('entity ids (FR-ARCH-001)', () => {
  it('are unique and stable for the lifetime of the store', () => {
    const store = new EntityStore();
    const a = store.createEntity();
    const b = store.createEntity();
    expect(a).not.toBe(b);
    store.addComponent(a, Position, { x: 1, y: 2 });
    store.removeComponent(a, Position);
    expect(store.query(Position)).toEqual([]);
    store.addComponent(a, Position, { x: 3, y: 4 });
    expect(store.query(Position)).toEqual([a]);
  });

  it('serialize for save/load: JSON round-trip preserves identity', () => {
    const store = new EntityStore();
    const id = store.createEntity();
    const revived = JSON.parse(JSON.stringify(id)) as EntityId;
    expect(revived).toBe(id);
  });

  it('id generation is deterministic: two stores issue identical id sequences', () => {
    const issue = () => {
      const store = new EntityStore();
      return [store.createEntity(), store.createEntity(), store.createEntity()];
    };
    expect(issue()).toEqual(issue());
  });

  it('rejects component operations on ids the store never issued', () => {
    const store = new EntityStore();
    const foreign = 999 as EntityId;
    expect(() => store.addComponent(foreign, Position, { x: 0, y: 0 })).toThrow(/unknown entity/);
    expect(() => store.getComponent(foreign, Position)).toThrow(/unknown entity/);
  });
});

describe('components are data-only (FR-ARCH-002)', () => {
  it('stores and returns plain data verbatim', () => {
    const store = new EntityStore();
    const e = store.createEntity();
    store.addComponent(e, Position, { x: 5, y: 7 });
    expect(store.getComponent(e, Position)).toEqual({ x: 5, y: 7 });
  });

  it('rejects behavior-carrying component types at compile time', () => {
    // @ts-expect-error — functions are not ComponentData; logic lives in Systems.
    defineComponentType<{ update: () => void }>('behavior');
    // @ts-expect-error — a bare function is not ComponentData either.
    const fn: ComponentData = () => undefined;
    void fn;
  });
});

describe('composition queries (FR-ARCH-003)', () => {
  it('returns exactly the entities with the requested component set', () => {
    const store = new EntityStore();
    const both = store.createEntity();
    const positionOnly = store.createEntity();
    const renderableOnly = store.createEntity();
    store.createEntity(); // bare entity, matches nothing
    store.addComponent(both, Position, { x: 0, y: 0 });
    store.addComponent(both, Renderable, { assetRef: 'asset.placeholder' });
    store.addComponent(positionOnly, Position, { x: 1, y: 1 });
    store.addComponent(renderableOnly, Renderable, { assetRef: 'asset.placeholder' });

    expect(store.query(Position, Renderable)).toEqual([both]);
    expect(new Set(store.query(Position))).toEqual(new Set([both, positionOnly]));
  });

  it('reflects removals: membership updates as composition changes', () => {
    const store = new EntityStore();
    const e = store.createEntity();
    store.addComponent(e, Position, { x: 0, y: 0 });
    store.addComponent(e, Interactable, true);
    expect(store.query(Position, Interactable)).toEqual([e]);
    store.removeComponent(e, Interactable);
    expect(store.query(Position, Interactable)).toEqual([]);
    expect(store.query(Position)).toEqual([e]);
  });

  it('replaces the value when a component is added twice', () => {
    const store = new EntityStore();
    const e = store.createEntity();
    store.addComponent(e, Position, { x: 0, y: 0 });
    store.addComponent(e, Position, { x: 9, y: 9 });
    expect(store.getComponent(e, Position)).toEqual({ x: 9, y: 9 });
    expect(store.query(Position)).toEqual([e]);
  });

  it('iterates in a reproducible order for the same operation sequence', () => {
    const run = () => {
      const store = new EntityStore();
      const ids = [store.createEntity(), store.createEntity(), store.createEntity()];
      for (const id of ids) store.addComponent(id, Position, { x: 0, y: 0 });
      return store.query(Position);
    };
    expect(run()).toEqual(run());
  });
});

describe('open component-type registration (FR-ARCH-004)', () => {
  // A "plugin": defines its own component type with zero core edits.
  const fakePlugin = {
    FuelLevel: defineComponentType<{ litres: number }>('fake-plugin.fuel-level'),
  };

  it('a plugin-defined component type works without core changes', () => {
    const store = new EntityStore();
    const generator = store.createEntity();
    store.addComponent(generator, fakePlugin.FuelLevel, { litres: 40 });
    store.addComponent(generator, Position, { x: 2, y: 3 });

    expect(store.query(fakePlugin.FuelLevel, Position)).toEqual([generator]);
    expect(store.getComponent(generator, fakePlugin.FuelLevel)).toEqual({ litres: 40 });
    expect(store.hasComponent(generator, fakePlugin.FuelLevel)).toBe(true);
  });

  it('fails loudly when two distinct descriptors collide on one id', () => {
    const store = new EntityStore();
    const e = store.createEntity();
    const original = defineComponentType<number>('collision.demo');
    const impostor = defineComponentType<number>('collision.demo');
    store.addComponent(e, original, 1);
    expect(() => store.addComponent(e, impostor, 2)).toThrow(/duplicate component type id/);
  });
});
