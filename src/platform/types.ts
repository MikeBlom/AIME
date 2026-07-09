/**
 * The narrow platform interfaces (NFR-ARCH-004): render surface, input
 * devices, audio output, storage, and timers — the only faces through which
 * the engine may touch a host. Systems consume these via the Context's
 * `platform` slot; swapping the backend (browser, native shell, headless
 * test double) touches only this layer.
 *
 * Layering: dependencies point downward only, so this bottom layer imports
 * nothing from Core. Shapes Core also names (the input snapshot's JSON data,
 * the frame ticker) are declared here structurally compatible instead.
 */

/**
 * Plain, JSON-like data with no functions — structurally identical to
 * Core's ComponentData/EventPayload, declared here because the bottom
 * layer must not import upward.
 */
export type PlatformData =
  | string
  | number
  | boolean
  | null
  | readonly PlatformData[]
  | { readonly [key: string]: PlatformData };

/** Horizontal anchoring for `drawText`; `x` is the anchored edge/center. */
export type TextAlign = 'left' | 'center' | 'right';

/** Per-call text options; backends apply defaults where omitted. */
export interface DrawTextOptions {
  /** CSS color string. Default is backend-defined (a legible light tone). */
  readonly color?: string;
  /** Font size in surface pixels. Default is backend-defined. */
  readonly sizePx?: number;
  readonly align?: TextAlign;
}

/**
 * A render surface able to draw simple primitives, sprites, and text.
 * Coordinates are surface pixels, origin top-left. Colors are CSS color
 * strings — a host-agnostic notation every backend can interpret or record.
 */
export interface RenderSurface {
  /** Current drawable size in pixels. */
  size(): { readonly width: number; readonly height: number };
  /** Fill the whole surface with one color, discarding prior drawing. */
  clear(color: string): void;
  fillRect(x: number, y: number, width: number, height: number, color: string): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, color: string, width?: number): void;
  /**
   * Draw one line of already-localized text with `y` as the top edge. The
   * text arrives resolved from the content pack's locale strings — never a
   * career fact from engine code. Fonts are backend-owned (a generic host
   * UI face), so no asset dependency exists for text.
   */
  drawText(text: string, x: number, y: number, options?: DrawTextOptions): void;
  /**
   * Draw the sprite asset named by `assetRef` (an asset id/URL from the
   * content pack's manifest — never a career fact). The backend owns
   * loading and caching; a sprite not yet loaded draws nothing this frame
   * and appears once ready (graceful, per FR-ARCH-008's spirit).
   */
  drawSprite(assetRef: string, x: number, y: number, width?: number, height?: number): void;
}

/**
 * One frame's device state as plain data (FR-ARCH-023): the loop samples
 * this once per frame and freezes it, so every System observes identical
 * input. Keys are sorted physical key codes; buttons are sorted pointer
 * button indices — sorted so identical device state always snapshots to
 * identical data (NFR-ARCH-001).
 */
export type InputSnapshot = {
  readonly keys: readonly string[];
  readonly pointer: {
    readonly x: number;
    readonly y: number;
    readonly buttons: readonly number[];
  };
};

/** An input device producing the per-frame snapshot. */
export interface InputDevice {
  /** A fresh plain-data snapshot of current device state; never a live view. */
  snapshot(): InputSnapshot;
}

/**
 * Per-cue playback parameters — the Audio System's spatialization hook:
 * it computes these from world state (emitter position vs. the camera) and
 * the backend applies them however its mixer can.
 */
export interface AudioPlayOptions {
  /** Linear cue gain in [0, 1], multiplied under the master volume. Default 1. */
  readonly gain?: number;
  /** Stereo pan in [-1, 1], left to right. Default 0 (center). */
  readonly pan?: number;
}

/**
 * Audio output: fire-and-forget one-shot cues plus named looping channels
 * (the Audio System uses `ambient` and `music` buses). `soundRef` is an
 * asset address resolved from the content pack's manifest — never a career
 * fact. A ref the backend cannot decode stays silent rather than faulting
 * (FR-ARCH-008).
 */
export interface AudioOutput {
  play(soundRef: string, options?: AudioPlayOptions): void;
  /**
   * Set or replace the looping bed on a named channel; `null` stops the
   * channel. Re-setting the same ref only retunes its gain.
   */
  setLoop(channel: string, soundRef: string | null, options?: { readonly gain?: number }): void;
  /** Master volume in [0, 1]. */
  setMasterVolume(level: number): void;
}

/**
 * Screen-reader narration: announce one line of already-localized essential
 * content (a prompt, a hint, a dialogue line) through the host's assistive
 * channel — an ARIA live region in a browser, a recorded call in tests. The
 * text arrives resolved from the content pack's locale strings, never a
 * career fact from engine code. Hosts without assistive output may no-op.
 */
export interface NarrationChannel {
  announce(text: string): void;
}

/** Narrow persistent key-value storage for save/load and settings. */
export interface KeyValueStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Host timers. `frameTicker` is structurally Core's FrameTicker: it starts
 * host frame callbacks (requestAnimationFrame or a test script) and returns
 * a stop function; `elapsedSeconds` is wall time since the last callback.
 * `monotonicNowMs` feeds the loop's observability probe only — simulation
 * time always comes from Core's TimeService, never from here.
 */
export interface TimerSource {
  frameTicker(onFrame: (elapsedSeconds: number) => void): () => void;
  monotonicNowMs(): number;
}

/**
 * The full adapter bundle a host backend provides, consumed via the
 * Context's `platform` slot. A type alias (not an interface) so it is
 * assignable to Core's open `PlatformInterfaces` record without this layer
 * importing upward.
 */
export type Platform = {
  readonly render: RenderSurface;
  readonly input: InputDevice;
  readonly audio: AudioOutput;
  readonly storage: KeyValueStorage;
  readonly timers: TimerSource;
  readonly narration: NarrationChannel;
};
