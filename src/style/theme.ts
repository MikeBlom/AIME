/**
 * Engine presentation theme — the single source of visual truth
 * (issue #36; spec: docs/12-Art-Direction.md).
 *
 * Every color the engine draws resolves from this table by named role
 * (FR-ART-001); no System or platform module carries its own color
 * literals (enforced by src/style/theme.test.ts). Roles are keyed by the
 * generic scene vocabulary — kinds, region states, chrome surfaces —
 * never by anything career-specific (FR-ART-002), so the theme restyles
 * every Content Pack uniformly.
 *
 * Values are plain data: swapping the visual identity is an edit here
 * (or, later, a loaded theme document), not a sweep across screens.
 * Motion tokens name the engine's motion feel the same way (FR-ART-005);
 * simulation constants that realize them re-export from here so tuning
 * stays a one-line change.
 */

/** A CSS color string (hex or rgba); the platform layer passes it through. */
export type ThemeColor = string;

export interface ThemePalette {
  /** Letterbox backdrop outside the logical viewport — the darkest tone. */
  readonly backdrop: ThemeColor;
  /** Region ground by live state; unknown states read as `regionOffline`. */
  readonly regionOffline: ThemeColor;
  readonly regionOnline: ThemeColor;
  /** Hairline framing the logical space's top and bottom edges. */
  readonly regionBorder: ThemeColor;
  /** Rect-fallback fill per generic renderable kind (FR-ART-003). */
  readonly kind: { readonly [kind: string]: ThemeColor };
  /** Fill for kinds the table does not name. */
  readonly kindFallback: ThemeColor;
  /** UI chrome: panel scrim, panel hairline, and the text roles. */
  readonly panel: ThemeColor;
  readonly panelEdge: ThemeColor;
  readonly text: ThemeColor;
  readonly textMuted: ThemeColor;
  /** The single accent: selection, focus, and the player share it. */
  readonly accent: ThemeColor;
  /** Night lighting overlay written to ENVIRONMENT_LIGHT (FR-ART-004). */
  readonly nightTint: ThemeColor;
  /** Space-transition cover: `rgb` triplet; presentation varies alpha. */
  readonly transitionRgb: string;
  /** Debug overlay chrome (developer-facing, still one hand). */
  readonly overlayText: ThemeColor;
  readonly overlayScrim: ThemeColor;
}

export interface ThemeMotion {
  /** Interior/exterior transition length (seconds of simulation time). */
  readonly spaceTransitionSeconds: number;
  /** Camera follow damping in 1/seconds (higher snaps faster). */
  readonly cameraFollowDamping: number;
  /** Looping sprite animation cadence (frames per second). */
  readonly animationFps: number;
  /** One-shot animation length (seconds) when content declares none. */
  readonly oneShotSeconds: number;
}

export interface Theme {
  readonly palette: ThemePalette;
  readonly motion: ThemeMotion;
}

/**
 * The default identity: a quiet industrial dusk. Deep blue-slate world
 * tones; restored regions warm toward green; people are lamplight amber;
 * the player and everything selectable share one cool cyan accent. See
 * docs/12-Art-Direction.md for the rationale behind each anchor.
 */
export const THEME: Theme = Object.freeze({
  palette: Object.freeze({
    backdrop: '#06080c',
    regionOffline: '#131a24',
    regionOnline: '#1d2b26',
    regionBorder: '#2c3a4a',
    kind: Object.freeze({
      player: '#7ec8ff',
      building: '#415062',
      npc: '#c9a86a',
      wall: '#2c3a4a',
      doorway: '#8a97a5',
      furnishing: '#4a5a6e',
      poi: '#9fd6a8',
    }),
    kindFallback: '#5a6675',
    panel: 'rgba(10, 14, 20, 0.85)',
    panelEdge: '#2c3a4a',
    text: '#e6edf3',
    textMuted: '#9fb0c0',
    accent: '#7ec8ff',
    nightTint: 'rgba(10, 14, 34, 0.35)',
    transitionRgb: '6, 8, 12',
    overlayText: '#9fb0c0',
    overlayScrim: 'rgba(6, 8, 12, 0.75)',
  }),
  motion: Object.freeze({
    spaceTransitionSeconds: 0.6,
    cameraFollowDamping: 8,
    animationFps: 8,
    oneShotSeconds: 0.4,
  }),
});
