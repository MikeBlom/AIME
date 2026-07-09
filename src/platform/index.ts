/**
 * Platform Adapter (bottom layer) — the only layer that touches the host
 * environment: render surface, input devices, audio, timers, and storage.
 * Exposes these as narrow interfaces so the rest of the engine is
 * host-agnostic; swapping the backend touches only this directory
 * (NFR-ARCH-004). See docs/02-System-Architecture.md, "Architectural
 * Layers", and the check-host-coupling gate that enforces the boundary.
 */
export type {
  AudioOutput,
  AudioPlayOptions,
  DrawTextOptions,
  InputDevice,
  InputSnapshot,
  KeyValueStorage,
  NarrationChannel,
  Platform,
  PlatformData,
  RenderSurface,
  TextAlign,
  TimerSource,
} from './types';

export { createBrowserPlatform } from './browser';
export type { BrowserPlatform } from './browser';

export { mountBrowserHost } from './browser-host';
export type { BrowserHost } from './browser-host';

export { createHeadlessPlatform } from './headless';
export type {
  AudioPlayCall,
  HeadlessAudioOutput,
  HeadlessInputDevice,
  HeadlessNarrationChannel,
  HeadlessPlatform,
  HeadlessPlatformOptions,
  HeadlessRenderSurface,
  HeadlessTimerSource,
  RenderCommand,
} from './headless';

export const LAYER = 'platform';
