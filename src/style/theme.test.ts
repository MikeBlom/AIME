/**
 * Art direction gate (issue #36; spec: docs/12-Art-Direction.md).
 *
 * Two of the three testable claims standing in for "authored by a single
 * hand" (NFR-VIS-007): the theme table is well-formed and immutable, and
 * its text roles clear WCAG contrast over the chrome they draw on
 * (NFR-ART-001). The third — no color literal outside the style layer
 * (FR-ART-001, issue AC2) — is the source scan in
 * scripts/style-literals.test.mjs.
 */
import { describe, expect, it } from 'vitest';
import { THEME } from './theme';

/** Generic scene roles rendering falls back on (docs/30-Rendering.md). */
const SCENE_KINDS = ['player', 'building', 'npc', 'wall', 'doorway', 'furnishing', 'poi'];

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const RGBA_COLOR = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0|1|0?\.\d+)\s*\)$/;
const RGB_TRIPLET = /^\d+\s*,\s*\d+\s*,\s*\d+$/;

type Rgb = { r: number; g: number; b: number };

function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const hex = HEX_COLOR.exec(value);
  if (hex !== null) {
    return {
      rgb: {
        r: parseInt(value.slice(1, 3), 16),
        g: parseInt(value.slice(3, 5), 16),
        b: parseInt(value.slice(5, 7), 16),
      },
      alpha: 1,
    };
  }
  const parts = /^rgba\(([^)]*)\)$/.exec(value)?.[1]?.split(',').map(Number);
  if (parts === undefined || parts.length !== 4 || parts.some(Number.isNaN)) {
    throw new Error(`unparseable theme color: ${value}`);
  }
  const [r, g, b, alpha] = parts as [number, number, number, number];
  return { rgb: { r, g, b }, alpha };
}

/** WCAG 2.x relative luminance of an opaque sRGB color. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colors. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The translucent panel composited over a world background. */
function composite(over: string, under: string): Rgb {
  const fg = parseColor(over);
  const bg = parseColor(under).rgb;
  const blend = (f: number, b: number) => Math.round(fg.alpha * f + (1 - fg.alpha) * b);
  return { r: blend(fg.rgb.r, bg.r), g: blend(fg.rgb.g, bg.g), b: blend(fg.rgb.b, bg.b) };
}

describe('theme table', () => {
  it('every palette role is a well-formed color', () => {
    const { kind, transitionRgb, ...roles } = THEME.palette;
    for (const [role, value] of Object.entries({ ...roles, ...kind })) {
      expect(HEX_COLOR.test(value) || RGBA_COLOR.test(value), `palette.${role} = ${value}`).toBe(
        true,
      );
    }
    expect(transitionRgb).toMatch(RGB_TRIPLET);
  });

  it('covers every generic scene kind rendering can fall back on', () => {
    for (const kind of SCENE_KINDS) {
      expect(THEME.palette.kind[kind], `kind.${kind}`).toBeDefined();
    }
  });

  it('is deeply frozen — style is data, and nothing mutates it at runtime', () => {
    expect(Object.isFrozen(THEME)).toBe(true);
    expect(Object.isFrozen(THEME.palette)).toBe(true);
    expect(Object.isFrozen(THEME.palette.kind)).toBe(true);
    expect(Object.isFrozen(THEME.motion)).toBe(true);
  });

  it('motion tokens are positive and finite', () => {
    for (const [token, value] of Object.entries(THEME.motion)) {
      expect(Number.isFinite(value) && value > 0, `motion.${token} = ${value}`).toBe(true);
    }
  });
});

describe('contrast (NFR-ART-001, serving NFR-VIS-003)', () => {
  const grounds = [THEME.palette.regionOffline, THEME.palette.regionOnline];

  it('body text clears WCAG AA (4.5:1) on the panel over any region', () => {
    for (const ground of grounds) {
      const panel = composite(THEME.palette.panel, ground);
      expect(contrast(parseColor(THEME.palette.text).rgb, panel)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseColor(THEME.palette.textMuted).rgb, panel)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the accent stays legible as selected text on the panel', () => {
    for (const ground of grounds) {
      const panel = composite(THEME.palette.panel, ground);
      expect(contrast(parseColor(THEME.palette.accent).rgb, panel)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the player accent reads against both region grounds (3:1 graphics)', () => {
    for (const ground of grounds) {
      const player = THEME.palette.kind['player'] as string;
      expect(contrast(parseColor(player).rgb, parseColor(ground).rgb)).toBeGreaterThanOrEqual(3);
    }
  });
});
