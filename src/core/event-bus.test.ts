import { describe, expect, it } from 'vitest';
import { EventBus, defineEventType } from './event-bus';

const Restored = defineEventType<{ regionId: string }>('system.restored');
const Interacted = defineEventType<{ entityId: number }>('player.interacted');

describe('typed publish/subscribe (FR-ARCH-009)', () => {
  it('delivers a typed event to many subscribers of that type', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, (e) => seen.push(`a:${e.payload.regionId}`));
    bus.subscribe(Restored, (e) => seen.push(`b:${e.payload.regionId}`));
    bus.publish(Restored, { regionId: 'region.arrival' }, 'immediate');
    expect(seen).toEqual(['a:region.arrival', 'b:region.arrival']);
  });

  it('does not deliver to subscribers of other event types', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Interacted, () => seen.push('wrong'));
    bus.publish(Restored, { regionId: 'region.arrival' }, 'immediate');
    expect(seen).toEqual([]);
  });

  it('subscribe returns an unsubscribe function', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe(Restored, () => seen.push('once'));
    bus.publish(Restored, { regionId: 'r.a' }, 'immediate');
    unsubscribe();
    bus.publish(Restored, { regionId: 'r.b' }, 'immediate');
    expect(seen).toEqual(['once']);
  });
});

describe('deterministic, stable ordering (FR-ARCH-010)', () => {
  it('invokes subscribers by ascending priority, then registration order', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, () => seen.push('default-first'));
    bus.subscribe(Restored, () => seen.push('late'), 10);
    bus.subscribe(Restored, () => seen.push('early'), -10);
    bus.subscribe(Restored, () => seen.push('default-second'));
    bus.publish(Restored, { regionId: 'r.a' }, 'immediate');
    expect(seen).toEqual(['early', 'default-first', 'default-second', 'late']);
  });

  it('two runs with identical inputs deliver events in identical order', () => {
    const run = () => {
      const bus = new EventBus();
      const seen: string[] = [];
      bus.subscribe(Restored, (e) => seen.push(`r1:${e.payload.regionId}`), 5);
      bus.subscribe(Restored, (e) => seen.push(`r2:${e.payload.regionId}`));
      bus.subscribe(Interacted, (e) => seen.push(`i:${e.payload.entityId}`));
      bus.publish(Restored, { regionId: 'r.a' });
      bus.publish(Interacted, { entityId: 1 });
      bus.publish(Restored, { regionId: 'r.b' }, 'immediate');
      bus.flushDeferred();
      return seen;
    };
    expect(run()).toEqual(run());
  });

  it('a subscriber added during delivery does not receive the in-flight event', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, () => {
      bus.subscribe(Restored, () => seen.push('late-joiner'));
      seen.push('original');
    });
    bus.publish(Restored, { regionId: 'r.a' }, 'immediate');
    expect(seen).toEqual(['original']);
  });
});

describe('immutable events (FR-ARCH-011)', () => {
  it('a subscriber cannot mutate an event observed by a later subscriber', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    let mutationError: unknown;
    bus.subscribe(Restored, (e) => {
      try {
        (e.payload as { regionId: string }).regionId = 'region.hijacked';
      } catch (err) {
        mutationError = err;
      }
    });
    bus.subscribe(Restored, (e) => seen.push(e.payload.regionId));
    bus.publish(Restored, { regionId: 'region.arrival' }, 'immediate');
    expect(mutationError).toBeInstanceOf(TypeError);
    expect(seen).toEqual(['region.arrival']);
  });

  it('freezes nested payload data too', () => {
    const Nested = defineEventType<{ inner: { value: number } }>('test.nested');
    const bus = new EventBus();
    let observed: { value: number } | undefined;
    bus.subscribe(Nested, (e) => {
      observed = e.payload.inner;
    });
    bus.publish(Nested, { inner: { value: 1 } }, 'immediate');
    expect(Object.isFrozen(observed)).toBe(true);
  });
});

describe('immediate vs deferred delivery (FR-ARCH-012)', () => {
  it('defers by default: nothing is delivered until the flush hook runs', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, (e) => seen.push(e.payload.regionId));
    bus.publish(Restored, { regionId: 'r.a' });
    expect(seen).toEqual([]);
    expect(bus.flushDeferred()).toBe(1);
    expect(seen).toEqual(['r.a']);
  });

  it('delivers immediate events within the publishing call', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, (e) => seen.push(e.payload.regionId));
    bus.publish(Restored, { regionId: 'r.now' }, 'immediate');
    expect(seen).toEqual(['r.now']);
  });

  it('deferred events published during a flush wait for the next flush', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, (e) => {
      seen.push(e.payload.regionId);
      if (e.payload.regionId === 'r.first') bus.publish(Restored, { regionId: 'r.chained' });
    });
    bus.publish(Restored, { regionId: 'r.first' });
    expect(bus.flushDeferred()).toBe(1);
    expect(seen).toEqual(['r.first']);
    expect(bus.flushDeferred()).toBe(1);
    expect(seen).toEqual(['r.first', 'r.chained']);
  });

  it('flushes queued events in publish order', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(Restored, (e) => seen.push(e.payload.regionId));
    bus.publish(Restored, { regionId: 'r.1' });
    bus.publish(Restored, { regionId: 'r.2' });
    bus.publish(Restored, { regionId: 'r.3' });
    bus.flushDeferred();
    expect(seen).toEqual(['r.1', 'r.2', 'r.3']);
  });
});

describe('observable event log (FR-ARCH-013)', () => {
  it('records publication and delivery with sequence numbers when enabled', () => {
    const bus = new EventBus({ logEnabled: true });
    bus.subscribe(Restored, () => undefined);
    bus.publish(Restored, { regionId: 'r.a' });
    bus.flushDeferred();
    bus.publish(Interacted, { entityId: 7 }, 'immediate');

    const summary = bus.eventLog.map((e) => `${e.seq}:${e.kind}:${e.type}:${e.delivery}`);
    expect(summary).toEqual([
      '0:published:system.restored:deferred',
      '1:delivered:system.restored:deferred',
      '2:published:player.interacted:immediate',
      '3:delivered:player.interacted:immediate',
    ]);
  });

  it('stays empty when disabled, and logging does not change delivery behavior', () => {
    const seenFor = (logEnabled: boolean) => {
      const bus = new EventBus({ logEnabled });
      const seen: string[] = [];
      bus.subscribe(Restored, (e) => seen.push(e.payload.regionId));
      bus.publish(Restored, { regionId: 'r.a' });
      bus.flushDeferred();
      return { seen, logLength: bus.eventLog.length };
    };
    const off = seenFor(false);
    const on = seenFor(true);
    expect(off.seen).toEqual(on.seen);
    expect(off.logLength).toBe(0);
    expect(on.logLength).toBeGreaterThan(0);
  });
});
