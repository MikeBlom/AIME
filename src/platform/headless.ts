/**
 * Headless platform backend: a fully deterministic, host-free adapter for
 * tests, record/replay tooling, and server-side runs (NFR-ARCH-002). It
 * records draw and audio calls instead of performing them, exposes
 * scriptable input, keeps storage in memory, and advances time only when
 * told to — no wall clock, no randomness, no host calls anywhere.
 *
 * That this backend and the browser one are interchangeable behind the same
 * `Platform` type is the layer's contract: swapping the host touches only
 * this directory (NFR-ARCH-004).
 */
import type {
  AudioOutput,
  InputDevice,
  InputSnapshot,
  KeyValueStorage,
  Platform,
  PlatformData,
  RenderSurface,
  TimerSource,
} from './types';

/** One recorded render call, as plain data for easy assertions. */
export type RenderCommand = { readonly [key: string]: PlatformData };

export interface HeadlessRenderSurface extends RenderSurface {
  /** Every draw call since construction (or the last `reset`), in order. */
  readonly commands: readonly RenderCommand[];
  reset(): void;
}

export interface HeadlessInputDevice extends InputDevice {
  press(key: string): void;
  release(key: string): void;
  movePointer(x: number, y: number): void;
  setButton(button: number, down: boolean): void;
}

/** One recorded one-shot cue with its resolved playback parameters. */
export type AudioPlayCall = {
  readonly soundRef: string;
  readonly gain: number;
  readonly pan: number;
};

export interface HeadlessAudioOutput extends AudioOutput {
  /** Every `play` call's soundRef, in order. */
  readonly played: readonly string[];
  /** Every `play` call with its gain/pan, in order. */
  readonly playCalls: readonly AudioPlayCall[];
  /** Currently looping channels: channel → { soundRef, gain }. */
  readonly loops: Readonly<Record<string, { readonly soundRef: string; readonly gain: number }>>;
  /** Last value passed to `setMasterVolume`, clamped to [0, 1]. */
  readonly masterVolume: number;
}

export interface HeadlessTimerSource extends TimerSource {
  /** Deliver one frame of `elapsedSeconds` to every registered callback. */
  tick(elapsedSeconds: number): void;
  /** Advance the monotonic probe clock (observability only). */
  advanceMs(milliseconds: number): void;
}

export type HeadlessPlatform = Platform & {
  readonly render: HeadlessRenderSurface;
  readonly input: HeadlessInputDevice;
  readonly audio: HeadlessAudioOutput;
  readonly storage: KeyValueStorage;
  readonly timers: HeadlessTimerSource;
};

export interface HeadlessPlatformOptions {
  readonly width?: number;
  readonly height?: number;
}

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 180;

/** Build a headless adapter; all five interfaces share no state. */
export function createHeadlessPlatform(options: HeadlessPlatformOptions = {}): HeadlessPlatform {
  return {
    render: createRenderSurface(options.width ?? DEFAULT_WIDTH, options.height ?? DEFAULT_HEIGHT),
    input: createInputDevice(),
    audio: createAudioOutput(),
    storage: createStorage(),
    timers: createTimerSource(),
  };
}

function createRenderSurface(width: number, height: number): HeadlessRenderSurface {
  const commands: RenderCommand[] = [];
  return {
    size: () => ({ width, height }),
    clear: (color) => commands.push({ op: 'clear', color }),
    fillRect: (x, y, w, h, color) =>
      commands.push({ op: 'fillRect', x, y, width: w, height: h, color }),
    drawLine: (x1, y1, x2, y2, color, lineWidth = 1) =>
      commands.push({ op: 'drawLine', x1, y1, x2, y2, color, lineWidth }),
    drawSprite: (assetRef, x, y, w, h) =>
      commands.push({ op: 'drawSprite', assetRef, x, y, width: w ?? null, height: h ?? null }),
    drawText: (text, x, y, options) =>
      commands.push({
        op: 'drawText',
        text,
        x,
        y,
        color: options?.color ?? null,
        sizePx: options?.sizePx ?? null,
        align: options?.align ?? null,
      }),
    get commands() {
      return commands.slice();
    },
    reset: () => {
      commands.length = 0;
    },
  };
}

function createInputDevice(): HeadlessInputDevice {
  const keys = new Set<string>();
  const buttons = new Set<number>();
  let pointerX = 0;
  let pointerY = 0;
  return {
    press: (key) => keys.add(key),
    release: (key) => keys.delete(key),
    movePointer: (x, y) => {
      pointerX = x;
      pointerY = y;
    },
    setButton: (button, down) => (down ? buttons.add(button) : buttons.delete(button)),
    snapshot: (): InputSnapshot => ({
      keys: [...keys].sort(),
      pointer: { x: pointerX, y: pointerY, buttons: [...buttons].sort((a, b) => a - b) },
    }),
  };
}

function createAudioOutput(): HeadlessAudioOutput {
  const playCalls: AudioPlayCall[] = [];
  const loops = new Map<string, { soundRef: string; gain: number }>();
  let masterVolume = 1;
  return {
    play: (soundRef, options) => {
      playCalls.push({ soundRef, gain: options?.gain ?? 1, pan: options?.pan ?? 0 });
    },
    setLoop: (channel, soundRef, options) => {
      if (soundRef === null) {
        loops.delete(channel);
      } else {
        loops.set(channel, { soundRef, gain: options?.gain ?? 1 });
      }
    },
    setMasterVolume: (level) => {
      masterVolume = Math.min(1, Math.max(0, level));
    },
    get played() {
      return playCalls.map((call) => call.soundRef);
    },
    get playCalls() {
      return playCalls.slice();
    },
    get loops() {
      return Object.fromEntries(loops);
    },
    get masterVolume() {
      return masterVolume;
    },
  };
}

function createStorage(): KeyValueStorage {
  const entries = new Map<string, string>();
  return {
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

function createTimerSource(): HeadlessTimerSource {
  const callbacks = new Set<(elapsedSeconds: number) => void>();
  let nowMs = 0;
  return {
    frameTicker: (onFrame) => {
      callbacks.add(onFrame);
      return () => callbacks.delete(onFrame);
    },
    tick: (elapsedSeconds) => {
      for (const callback of [...callbacks]) callback(elapsedSeconds);
    },
    advanceMs: (milliseconds) => {
      nowMs += milliseconds;
    },
    monotonicNowMs: () => nowMs,
  };
}
