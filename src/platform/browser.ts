/**
 * Browser platform backend: canvas 2D rendering, DOM keyboard/pointer
 * input, storage over localStorage, and requestAnimationFrame timing. This
 * file (with the rest of src/platform) is the only place host APIs may
 * appear — the check-host-coupling gate enforces exactly that boundary
 * (NFR-ARCH-004).
 *
 * Audio is a stub honoring the AudioOutput contract; real mixing arrives
 * with the Phase 1 Audio System and changes only this layer.
 */
import type {
  AudioOutput,
  InputDevice,
  InputSnapshot,
  KeyValueStorage,
  Platform,
  RenderSurface,
  TimerSource,
} from './types';

export type BrowserPlatform = Platform & {
  /** Remove every DOM listener; the adapter is inert afterwards. */
  dispose(): void;
};

/** Build a browser adapter around a canvas the host page provides. */
export function createBrowserPlatform(canvas: HTMLCanvasElement): BrowserPlatform {
  const input = createInputDevice(canvas);
  return {
    render: createRenderSurface(canvas),
    input,
    audio: createAudioOutput(),
    storage: createStorage(),
    timers: createTimerSource(),
    dispose: () => input.dispose(),
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
  // Stub honoring the contract (the issue allows stubs where not yet used):
  // calls are accepted and volume is tracked so callers behave identically
  // when the real backend lands with the Phase 1 Audio System.
  let masterVolume = 1;
  return {
    play: () => {},
    setMasterVolume: (level) => {
      masterVolume = Math.min(1, Math.max(0, level));
      void masterVolume;
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
