/**
 * Browser host mount: the DOM scaffolding around the canvas adapter — a
 * viewport-filling canvas that tracks window size (desktop and mobile,
 * NFR-VIS-004), a monospace debug-overlay element (FR-ARCH-031), and
 * visibility-change notification so the loop can pause cleanly
 * (FR-ARCH-024). Lives in the platform layer because it is host coupling;
 * everything above consumes the returned narrow handle.
 *
 * `mountBrowserHost` returns null where no DOM exists, so importing the
 * entry module in a host-free environment (tests, tooling) is harmless.
 */

export interface BrowserHost {
  readonly canvas: HTMLCanvasElement;
  /** Replace the debug overlay's text block. */
  setOverlayText(text: string): void;
  /** Register for focus/visibility changes; called with `visible`. */
  onVisibilityChange(callback: (visible: boolean) => void): void;
  /** Remove all mounted elements and listeners. */
  dispose(): void;
}

export function mountBrowserHost(): BrowserHost | null {
  if (typeof document === 'undefined') return null;

  const root = document.getElementById('app') ?? document.body;

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  // Keep touch drags steering the world instead of scrolling the page.
  canvas.style.touchAction = 'none';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('pre');
  overlay.style.position = 'fixed';
  overlay.style.top = '8px';
  overlay.style.left = '8px';
  overlay.style.margin = '0';
  overlay.style.padding = '6px 8px';
  overlay.style.font = '10px/1.4 monospace';
  overlay.style.color = '#9fb3c8';
  overlay.style.background = 'rgba(6, 8, 12, 0.75)';
  overlay.style.pointerEvents = 'none';
  overlay.style.whiteSpace = 'pre';
  overlay.style.zIndex = '10';

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const visibilityCallbacks = new Set<(visible: boolean) => void>();
  const onVisibility = () => {
    for (const callback of visibilityCallbacks) callback(!document.hidden);
  };
  document.addEventListener('visibilitychange', onVisibility);

  root.append(canvas, overlay);

  return {
    canvas,
    setOverlayText: (text) => {
      overlay.textContent = text;
    },
    onVisibilityChange: (callback) => {
      visibilityCallbacks.add(callback);
    },
    dispose: () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
      overlay.remove();
      visibilityCallbacks.clear();
    },
  };
}
