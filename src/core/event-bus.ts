/**
 * Typed event bus — how Systems coordinate without coupling, from
 * docs/02-System-Architecture.md (FR-ARCH-009..013).
 *
 * Systems announce facts as immutable, typed events and react to facts they
 * subscribe to; they never call each other directly. Delivery order within a
 * tick is deterministic: ascending subscriber priority, then registration
 * order (FR-ARCH-010). Deferred events queue until the next tick boundary's
 * `flushDeferred()` (FR-ARCH-012); Systems should prefer deferred delivery
 * for cross-system effects, so it is the default.
 *
 * Determinism: no wall clock, no randomness; the read-only event log
 * (FR-ARCH-013) records sequence numbers, never timestamps.
 */
import type { ComponentData } from './entity-store';
import { deepFreeze } from './freeze';

/**
 * An event's payload is plain, immutable data (FR-ARCH-011) — the same
 * JSON-like shape components use. Behavior travels in Systems, not events.
 */
export type EventPayload = ComponentData;

/**
 * An event type descriptor: a stable string id carrying the payload type.
 * Core code and plugins define event types the same way (FR-ARCH-018).
 */
export interface EventType<T extends EventPayload> {
  readonly id: string;
  /** Phantom marker binding T to the descriptor; never set at runtime. */
  readonly __payload?: T;
}

/** Define an event type. Namespace ids (`quest.completed`) to avoid collisions. */
export function defineEventType<T extends EventPayload>(id: string): EventType<T> {
  return { id };
}

/** An immutable published event: type id plus deep-frozen payload. */
export interface EventRecord<T extends EventPayload = EventPayload> {
  readonly type: string;
  readonly payload: T;
}

export type EventHandler<T extends EventPayload> = (event: EventRecord<T>) => void;

/** When an event reaches subscribers (FR-ARCH-012). */
export type Delivery = 'immediate' | 'deferred';

/** One observable event-log entry (FR-ARCH-013). `seq` orders entries; no wall-clock. */
export interface EventLogEntry {
  readonly seq: number;
  readonly kind: 'published' | 'delivered';
  readonly type: string;
  readonly payload: EventPayload;
  readonly delivery: Delivery;
}

interface Subscriber {
  readonly handler: EventHandler<EventPayload>;
  readonly priority: number;
  readonly order: number;
}

export class EventBus {
  #subscribers = new Map<string, Subscriber[]>();
  #deferred: EventRecord[] = [];
  #registrationCounter = 0;
  #logSeq = 0;
  #log: EventLogEntry[] = [];
  #logEnabled: boolean;

  /** The event log costs nothing when disabled and never changes behavior. */
  constructor(options: { logEnabled?: boolean } = {}) {
    this.#logEnabled = options.logEnabled ?? false;
  }

  /**
   * Subscribe a handler to an event type (FR-ARCH-009). Lower `priority`
   * runs first; ties break by registration order (FR-ARCH-010). Returns an
   * unsubscribe function.
   */
  subscribe<T extends EventPayload>(
    type: EventType<T>,
    handler: EventHandler<T>,
    priority = 0,
  ): () => void {
    const list = this.#subscribers.get(type.id) ?? [];
    const subscriber: Subscriber = {
      handler: handler as EventHandler<EventPayload>,
      priority,
      order: this.#registrationCounter++,
    };
    list.push(subscriber);
    list.sort((a, b) => a.priority - b.priority || a.order - b.order);
    this.#subscribers.set(type.id, list);
    return () => {
      const current = this.#subscribers.get(type.id);
      if (current === undefined) return;
      const index = current.indexOf(subscriber);
      if (index !== -1) current.splice(index, 1);
    };
  }

  /**
   * Publish an event. Deferred (the default, per FR-ARCH-012's guidance)
   * queues until the next `flushDeferred()`; immediate delivers before this
   * call returns. The payload is deep-frozen either way (FR-ARCH-011).
   */
  publish<T extends EventPayload>(
    type: EventType<T>,
    payload: T,
    delivery: Delivery = 'deferred',
  ): void {
    const event: EventRecord = Object.freeze({ type: type.id, payload: deepFreeze(payload) });
    this.#logEntry('published', event, delivery);
    if (delivery === 'immediate') {
      this.#deliver(event, 'immediate');
    } else {
      this.#deferred.push(event);
    }
  }

  /**
   * Deliver every queued deferred event, in publish order — the tick-boundary
   * hook the runtime loop calls (FR-ARCH-012). Deferred events published
   * during the flush queue for the NEXT flush, so a tick never chases its own
   * tail. Returns the number of events delivered.
   */
  flushDeferred(): number {
    const batch = this.#deferred;
    this.#deferred = [];
    for (const event of batch) this.#deliver(event, 'deferred');
    return batch.length;
  }

  /** Read-only view of the event log (FR-ARCH-013); empty while disabled. */
  get eventLog(): readonly EventLogEntry[] {
    return this.#log;
  }

  #deliver(event: EventRecord, delivery: Delivery): void {
    this.#logEntry('delivered', event, delivery);
    // Snapshot so (un)subscriptions during delivery cannot reorder this event.
    const snapshot = [...(this.#subscribers.get(event.type) ?? [])];
    for (const subscriber of snapshot) subscriber.handler(event);
  }

  #logEntry(kind: EventLogEntry['kind'], event: EventRecord, delivery: Delivery): void {
    if (!this.#logEnabled) return;
    this.#log.push(
      Object.freeze({
        seq: this.#logSeq++,
        kind,
        type: event.type,
        payload: event.payload,
        delivery,
      }),
    );
  }
}
