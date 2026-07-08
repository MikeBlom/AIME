/**
 * Entry point. Boots the engine layers in order: mount the browser host and
 * platform adapter, then boot the world — content pack, core services,
 * systems, runtime loop — and start the frame ticker. In a host without a
 * DOM (tests, tooling) the mount returns null and importing this module is
 * a no-op, so the entry stays host-safe.
 */
import { bootWorld, packFilesFromBundle } from './app';
import { createBrowserPlatform, mountBrowserHost } from './platform';

/**
 * Fixed default seed (NFR-ARCH-001): every visit simulates identically
 * until a later issue makes the seed a session input.
 */
const DEFAULT_SEED = 0x5eed;

/** Mount and start the world in a browser; returns null where no DOM exists. */
export function bootBrowser(): (() => void) | null {
  const host = mountBrowserHost();
  if (host === null) return null;
  const platform = createBrowserPlatform(host.canvas);
  const handle = bootWorld({
    platform,
    packFiles: packFilesFromBundle(),
    seed: DEFAULT_SEED,
    onOverlayText: host.setOverlayText,
  });
  host.onVisibilityChange((visible) => {
    if (visible) {
      handle.loop.resume();
    } else {
      handle.loop.pause();
    }
  });
  const stop = handle.start();
  return () => {
    stop();
    handle.loop.teardown();
    platform.dispose();
    host.dispose();
  };
}

bootBrowser();
