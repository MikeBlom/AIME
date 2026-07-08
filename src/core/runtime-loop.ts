/**
 * Runtime loop — the deterministic, fixed-step heart of the engine, from
 * docs/02-System-Architecture.md, "The Runtime Loop" (FR-ARCH-021..025,
 * FR-ARCH-029; NFR-ARCH-001).
 *
 * Each host frame: sample input into an immutable snapshot (FR-ARCH-023),
 * accumulate elapsed time, then run whole fixed steps — deliver queued
 * events, then update Systems in dependency order — with catch-up clamped
 * so a long stall never causes a spiral of death (FR-ARCH-022). Presentation
 * gets an interpolation alpha between steps (FR-ARCH-021). Pausing discards
 * stalled time on resume, so backgrounding produces no spike (FR-ARCH-024).
 *
 * Determinism (FR-ARCH-025): the loop never reads a wall clock — elapsed
 * time arrives from the host ticker, simulation time and randomness come
 * from the injected TimeService/RngService, and a recorded session (seed +
 * per-frame elapsed + input) replays to identical world state. The optional
 * per-System timing probe uses an injected monotonic clock and observes
 * only; it never feeds back into simulation.
 */
import type { EventPayload } from './event-bus';
import { deepFreeze } from './freeze';
import type { ModuleRegistry, SystemContext } from './registry';
import { RngService } from './rng';
import { TimeService } from './time';

/** The immutable per-frame input boundary Systems read (FR-ARCH-023). */
export interface InputSnapshotBoundary {
  /** This frame's deep-frozen snapshot; identical for every System in the frame. */
  readonly current: EventPayload;
}

/**
 * Starts host frame callbacks and returns a stop function — the narrow face
 * of the platform's frame source (requestAnimationFrame or a test script).
 * `elapsedSeconds` is wall time since the previous callback.
 */
export type FrameTicker = (onFrame: (elapsedSeconds: number) => void) => () => void;

/** One isolated System failure (FR-ARCH-029): logged with context, never fatal. */
export interface SystemFault {
  readonly systemId: string;
  readonly step: number;
  readonly frame: number;
  readonly error: unknown;
}

/** One System's measured update duration for the debug overlay (FR-ARCH-031). */
export interface SystemTiming {
  readonly systemId: string;
  readonly milliseconds: number;
}

/** A recorded session: everything needed to reproduce it exactly (FR-ARCH-025). */
export interface Recording {
  readonly rngState: number;
  readonly frames: readonly { readonly elapsed: number; readonly input: EventPayload }[];
}

export interface RuntimeLoopOptions {
  /** Seconds of simulation per fixed step (FR-ARCH-021). */
  readonly fixedDt: number;
  /** Catch-up clamp: at most this many fixed steps per frame (FR-ARCH-022). */
  readonly maxStepsPerFrame?: number;
  /** Seed for the RngService on Context (NFR-ARCH-001). */
  readonly seed: number;
  /** Samples host input once per frame; the loop freezes the result (FR-ARCH-023). */
  readonly sampleInput?: () => EventPayload;
  /** Presentation hook: interpolation alpha in [0, 1) between fixed steps (FR-ARCH-021). */
  readonly onPresent?: (alpha: number, context: SystemContext) => void;
  /** Called for each isolated System fault, in addition to the fault log (FR-ARCH-029). */
  readonly onFault?: (fault: SystemFault) => void;
  /**
   * Monotonic milliseconds probe for per-System timings (FR-ARCH-031).
   * Injected so the simulation itself never touches a clock; omitted means
   * timings read as zero and behavior is byte-for-byte identical.
   */
  readonly monotonicNowMs?: () => number;
}

const DEFAULT_MAX_STEPS_PER_FRAME = 5;

/** Fault-log bound: a crash-looping System must not leak memory (FR-ARCH-029). */
const MAX_RETAINED_FAULTS = 1000;

/** The world-state/services half of a Context; the loop adds time, rng, and input. */
export type ContextSeed = Omit<SystemContext, 'time' | 'rng' | 'input'>;

/**
 * Drives registered Systems in dependency order: `run(ticker)` for a live
 * host, `frame(elapsed)` for scripted tests, `replay(recording)` for
 * record/replay (FR-ARCH-025). Owns the TimeService and RngService it puts
 * on the Context.
 */
export class RuntimeLoop {
  readonly context: SystemContext;
  #registry: ModuleRegistry;
  #options: RuntimeLoopOptions;
  #time: TimeService;
  #rng: RngService;
  #maxSteps: number;
  #accumulator = 0;
  #initialized = false;
  #paused = false;
  #inputCurrent: EventPayload = deepFreeze({});
  #faults: SystemFault[] = [];
  #timings: SystemTiming[] = [];
  #recording: { elapsed: number; input: EventPayload }[] | null = null;
  #recordingRngState = 0;

  constructor(registry: ModuleRegistry, seed: ContextSeed, options: RuntimeLoopOptions) {
    const maxSteps = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new Error(`maxStepsPerFrame must be a positive integer, got ${maxSteps}`);
    }
    this.#registry = registry;
    this.#options = options;
    this.#time = new TimeService(options.fixedDt);
    this.#rng = new RngService(options.seed);
    this.#maxSteps = maxSteps;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const boundary: InputSnapshotBoundary = {
      get current() {
        return self.#inputCurrent;
      },
    };
    this.context = {
      ...seed,
      time: this.#time,
      rng: this.#rng,
      input: boundary,
    };
  }

  /** Faults isolated so far (FR-ARCH-029), oldest first. */
  get faults(): readonly SystemFault[] {
    return this.#faults;
  }

  /** Per-System update durations for the last frame (FR-ARCH-031); zeros without a probe. */
  get lastFrameTimings(): readonly SystemTiming[] {
    return this.#timings;
  }

  /** True while simulation is paused (FR-ARCH-024). */
  get paused(): boolean {
    return this.#paused;
  }

  /** Pause simulation cleanly (focus/visibility loss, FR-ARCH-024). */
  pause(): void {
    this.#paused = true;
  }

  /**
   * Resume after a pause. Accumulated stall time is discarded — the next
   * frame starts from a clean anchor, so there is no catch-up spike
   * (FR-ARCH-022/024).
   */
  resume(): void {
    this.#paused = false;
    this.#accumulator = 0;
  }

  /** Init all Systems in dependency order; idempotent, called lazily by frame/run/replay. */
  init(): void {
    if (this.#initialized) return;
    this.#registry.initAll(this.context);
    this.#initialized = true;
  }

  /** Teardown all Systems in reverse order; the loop can be re-initialized after. */
  teardown(): void {
    if (!this.#initialized) return;
    this.#registry.teardownAll(this.context);
    this.#initialized = false;
  }

  /**
   * The `run()` entry point: subscribe to the host's frame ticker and drive
   * `frame()` until the returned stop function is called.
   */
  run(ticker: FrameTicker): () => void {
    this.init();
    return ticker((elapsedSeconds) => this.frame(elapsedSeconds));
  }

  /**
   * Process one host frame given elapsed wall seconds since the previous
   * one. Scripted `frame()` calls are the test/replay drive (NFR-ARCH-002).
   */
  frame(elapsedSeconds: number): void {
    this.init();
    if (this.#paused) return;
    const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
    const input = deepFreeze(this.#options.sampleInput?.() ?? {});
    this.#recording?.push({ elapsed, input });
    this.#advance(elapsed, input);
  }

  /**
   * Record/replay entry point: start capturing rng state plus each frame's
   * elapsed time and input snapshot (FR-ARCH-025).
   */
  startRecording(): void {
    this.#recordingRngState = this.#rng.state;
    this.#recording = [];
  }

  /** Stop capturing and return the session just recorded. */
  stopRecording(): Recording {
    if (this.#recording === null) {
      throw new Error(
        'stopRecording called with no recording in progress; call startRecording first',
      );
    }
    const frames = this.#recording;
    this.#recording = null;
    return { rngState: this.#recordingRngState, frames };
  }

  /**
   * Record/replay entry point: feed a recorded session back through the
   * loop. Given identical initial world state and content, the resulting
   * world state is identical (FR-ARCH-025).
   */
  replay(recording: Recording): void {
    this.init();
    this.#rng.restore(recording.rngState);
    for (const { elapsed, input } of recording.frames) {
      if (this.#paused) break;
      this.#advance(elapsed, deepFreeze(input));
    }
  }

  #advance(elapsed: number, input: EventPayload): void {
    this.#inputCurrent = input;
    this.#accumulator += elapsed;
    const fixedDt = this.#time.fixedDt;
    let steps = Math.floor(this.#accumulator / fixedDt);
    if (steps > this.#maxSteps) {
      // Clamp catch-up after a stall: run a bounded burst and drop the rest
      // of the backlog rather than replaying every missed step (FR-ARCH-022).
      steps = this.#maxSteps;
      this.#accumulator = steps * fixedDt;
    }
    for (let i = 0; i < steps; i += 1) {
      this.#accumulator -= fixedDt;
      this.context.events.flushDeferred();
      this.#updateSystems(fixedDt);
      this.#time.advanceStep();
    }
    this.#time.advanceFrame();
    this.#options.onPresent?.(this.#accumulator / fixedDt, this.context);
  }

  /** Update every System in order, isolating faults (FR-ARCH-029) and timing each (FR-ARCH-031). */
  #updateSystems(fixedDt: number): void {
    const probe = this.#options.monotonicNowMs;
    const timings: SystemTiming[] = [];
    for (const system of this.#registry.order) {
      const before = probe?.() ?? 0;
      try {
        system.update(fixedDt, this.context);
      } catch (error) {
        const fault: SystemFault = {
          systemId: system.id,
          step: this.#time.step,
          frame: this.#time.frame,
          error,
        };
        this.#faults.push(fault);
        if (this.#faults.length > MAX_RETAINED_FAULTS) this.#faults.shift();
        this.#options.onFault?.(fault);
      }
      timings.push({ systemId: system.id, milliseconds: (probe?.() ?? 0) - before });
    }
    this.#timings = timings;
  }
}
