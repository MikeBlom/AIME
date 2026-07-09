/**
 * Browser platform backend: canvas 2D rendering, DOM keyboard/pointer
 * input, storage over localStorage, and requestAnimationFrame timing. This
 * file (with the rest of src/platform) is the only place host APIs may
 * appear — the check-host-coupling gate enforces exactly that boundary
 * (NFR-ARCH-004).
 *
 * Audio plays through media elements: one-shot cues plus looping channel
 * beds, volumes under a master level. Full mixing (stereo pan and beyond)
 * upgrades to WebAudio inside this layer only.
 */
import { THEME } from '../style';
import type {
  AudioOutput,
  InputDevice,
  InputSnapshot,
  KeyValueStorage,
  NarrationChannel,
  Platform,
  RenderSurface,
  TelemetrySink,
  TimerSource,
} from './types';

export type BrowserPlatform = Platform & {
  /** Remove every DOM listener; the adapter is inert afterwards. */
  dispose(): void;
};

/** Build a browser adapter around a canvas the host page provides. */
export function createBrowserPlatform(canvas: HTMLCanvasElement): BrowserPlatform {
  const input = createInputDevice(canvas);
  const narration = createNarrationChannel();
  return {
    render: createRenderSurface(canvas),
    input,
    audio: createAudioOutput(),
    storage: createStorage(),
    timers: createTimerSource(),
    narration,
    telemetry: createTelemetrySink(),
    dispose: () => {
      input.dispose();
      narration.dispose();
    },
  };
}

/**
 * Local-only telemetry (docs/36's privacy stance): a bounded in-memory
 * buffer, no network, no persistence. A future transport upgrades inside
 * this layer only — and is an explicit product decision, never a default.
 */
function createTelemetrySink(): TelemetrySink {
  const buffer: { metric: string; value: number }[] = [];
  const CAP = 256;
  return {
    record: (metric, value) => {
      if (buffer.length >= CAP) buffer.shift();
      buffer.push({ metric, value });
    },
  };
}

function createNarrationChannel(): NarrationChannel & { dispose(): void } {
  // An ARIA live region: visually hidden (clipped to a pixel, never
  // display:none, which silences assistive tech), polite so narration
  // never interrupts itself mid-sentence. The canvas world is otherwise
  // invisible to a screen reader; this is its voice (NFR-VIS-003).
  const region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.style.position = 'absolute';
  region.style.width = '1px';
  region.style.height = '1px';
  region.style.overflow = 'hidden';
  region.style.clipPath = 'inset(50%)';
  region.style.whiteSpace = 'nowrap';
  document.body.append(region);
  return {
    announce: (text) => {
      // Clear first so repeating the same line still registers as a change.
      region.textContent = '';
      region.textContent = text;
    },
    dispose: () => {
      region.remove();
    },
  };
}

function createRenderSurface(canvas: HTMLCanvasElement): RenderSurface {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('canvas 2d context unavailable; the render surface cannot start');
  }
  // Sprite cache: the surface owns loading; a sprite draws once its image
  // has decoded and simply skips frames before that (no host errors leak up).
  const sprites = new Map<string, HTMLImageElement>();
  const spriteOf = (assetRef: string): HTMLImageElement => {
    let image = sprites.get(assetRef);
    if (image === undefined) {
      image = new Image();
      image.src = assetRef;
      sprites.set(assetRef, image);
    }
    return image;
  };
  return {
    size: () => ({ width: canvas.width, height: canvas.height }),
    clear: (color) => {
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
    },
    fillRect: (x, y, width, height, color) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    },
    drawLine: (x1, y1, x2, y2, color, width = 1) => {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    },
    drawSprite: (assetRef, x, y, width, height) => {
      const image = spriteOf(assetRef);
      if (!image.complete || image.naturalWidth === 0) return;
      context.drawImage(image, x, y, width ?? image.naturalWidth, height ?? image.naturalHeight);
    },
    drawText: (text, x, y, options) => {
      context.fillStyle = options?.color ?? THEME.palette.text;
      context.font = `${options?.sizePx ?? 14}px system-ui, sans-serif`;
      context.textAlign = options?.align ?? 'left';
      context.textBaseline = 'top';
      context.fillText(text, x, y);
    },
  };
}

function createInputDevice(canvas: HTMLCanvasElement): InputDevice & { dispose(): void } {
  const keys = new Set<string>();
  const buttons = new Set<number>();
  let pointerX = 0;
  let pointerY = 0;

  const onKeyDown = (event: KeyboardEvent) => keys.add(event.code);
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onPointerMove = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    pointerX = event.clientX - bounds.left;
    pointerY = event.clientY - bounds.top;
  };
  const onPointerDown = (event: PointerEvent) => buttons.add(event.button);
  const onPointerUp = (event: PointerEvent) => buttons.delete(event.button);
  const onBlur = () => {
    // Focus loss means key-up events may never arrive; clearing prevents
    // stuck keys when the experience resumes (FR-ARCH-024's spirit).
    keys.clear();
    buttons.clear();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  return {
    snapshot: (): InputSnapshot => ({
      keys: [...keys].sort(),
      pointer: { x: pointerX, y: pointerY, buttons: [...buttons].sort((a, b) => a - b) },
    }),
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
    },
  };
}

function createAudioOutput(): AudioOutput {
  // Media-element playback: enough to make cues and beds audible once real
  // assets ship. A ref that fails to load or decode stays silent — the
  // world never faults over a missing sound (FR-ARCH-008). `pan` is
  // accepted as the spatialization hook; applying it needs a WebAudio
  // mixer, which arrives in this layer without touching any System.
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const loops = new Map<string, { element: HTMLAudioElement; soundRef: string; gain: number }>();
  let masterVolume = 1;
  const applyLoopVolumes = () => {
    for (const loop of loops.values()) {
      loop.element.volume = clamp01(loop.gain) * masterVolume;
    }
  };
  return {
    play: (soundRef, options) => {
      const element = new Audio(soundRef);
      element.volume = clamp01(options?.gain ?? 1) * masterVolume;
      element.play().catch(() => undefined);
    },
    setLoop: (channel, soundRef, options) => {
      const current = loops.get(channel);
      if (soundRef === null) {
        current?.element.pause();
        loops.delete(channel);
        return;
      }
      const gain = options?.gain ?? 1;
      if (current !== undefined && current.soundRef === soundRef) {
        current.gain = gain;
        current.element.volume = clamp01(gain) * masterVolume;
        return;
      }
      current?.element.pause();
      const element = new Audio(soundRef);
      element.loop = true;
      element.volume = clamp01(gain) * masterVolume;
      loops.set(channel, { element, soundRef, gain });
      element.play().catch(() => undefined);
    },
    setMasterVolume: (level) => {
      masterVolume = clamp01(level);
      applyLoopVolumes();
    },
  };
}

function createStorage(): KeyValueStorage {
  // localStorage can be unavailable (privacy modes); degrade to in-memory
  // so the world still runs and only persistence is lost (FR-ARCH-008).
  const fallback = new Map<string, string>();
  const store = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    read: (key) => {
      const host = store();
      return host === null ? (fallback.get(key) ?? null) : host.getItem(key);
    },
    write: (key, value) => {
      const host = store();
      if (host === null) {
        fallback.set(key, value);
      } else {
        host.setItem(key, value);
      }
    },
    remove: (key) => {
      const host = store();
      if (host === null) {
        fallback.delete(key);
      } else {
        host.removeItem(key);
      }
    },
  };
}

function createTimerSource(): TimerSource {
  return {
    frameTicker: (onFrame) => {
      let handle = 0;
      let last: number | null = null;
      const step = (timestampMs: number) => {
        const elapsedSeconds = last === null ? 0 : (timestampMs - last) / 1000;
        last = timestampMs;
        onFrame(elapsedSeconds);
        handle = requestAnimationFrame(step);
      };
      handle = requestAnimationFrame(step);
      return () => cancelAnimationFrame(handle);
    },
    monotonicNowMs: () => performance.now(),
  };
}
