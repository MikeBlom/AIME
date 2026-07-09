import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { discoverPacks, readPackFiles } from './validate-content.mjs';

// Launch-readiness sweep (issue #45): the Vision's hardest acceptance bar —
// "No screen in the entire experience presents a resume, a job list, or a
// biography as primary content" (FR-VIS-006) — made machine-checkable over
// what we actually ship. Engine code cannot present resume text (it holds no
// career facts and renders only locale keys, enforced by the career-literals
// and validation gates), so the one place a resume surface could enter is
// the player-visible strings of a Content Pack. This suite scans every
// visible string of every shipped pack for resume-shaped text and proves
// the author-facing metaphor notes (DATA-FR-010) never leak into a visible
// channel. docs/48-Launch-Readiness-Report.md maps the full criterion set
// to its evidence, with this file as the FR-VIS-006 entry.

const CONTENT_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'content');

/**
 * Resume-shaped text: the vocabulary and scaffolding of a credential
 * document rather than of a world. Each pattern names what it catches so a
 * failure reads as a diagnostic, not a puzzle.
 */
const RESUME_PATTERNS = [
  { name: 'resume/CV vocabulary', re: /\bresumes?\b|\bcurriculum vitae\b|\bLinkedIn\b/i },
  { name: 'standalone CV abbreviation', re: /\bCV\b/ },
  {
    name: 'employment date span',
    re: /\b(?:19|20)\d{2}\s*(?:[-–—]|to\s)\s*(?:(?:19|20)\d{2}|present|now|today|current)\b/i,
  },
  { name: 'tenure claim', re: /\byears? of (?:professional\s+)?experience\b/i },
  { name: 'references boilerplate', re: /\breferences\s+(?:are\s+)?available\b/i },
  { name: 'job-listing scaffolding', re: /\b(?:work|employment)\s+history\b|\bjob\s+titles?\b/i },
];

/** Parse every JSON document of a pack, keyed by pack-relative path. */
function parsePack(packDir) {
  const docs = new Map();
  for (const [path, raw] of readPackFiles(packDir)) {
    docs.set(path, JSON.parse(raw));
  }
  return docs;
}

/**
 * Every string a player can ever see from this pack: all entries of every
 * locale document (DATA-FR-011 routes all visible text through these), plus
 * the manifest's creator fields, which surface in-world.
 */
function visibleStrings(docs) {
  const out = [];
  for (const [path, doc] of docs) {
    if (doc.schemaType === 'strings') {
      for (const [key, text] of Object.entries(doc.entries ?? {})) {
        out.push({ where: `${path} ${key}`, text });
      }
    } else if (doc.schemaType === 'pack') {
      for (const field of ['displayName', 'tagline']) {
        const text = doc.creator?.[field];
        if (typeof text === 'string') out.push({ where: `${path} creator.${field}`, text });
      }
    }
  }
  return out;
}

const packs = discoverPacks(CONTENT_ROOT);

describe('launch readiness: the no-resume-surface bar (issue #45, FR-VIS-006)', () => {
  it('ships at least the reference and second-creator packs', () => {
    // An empty discovery would make every scan below pass vacuously.
    expect(packs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(packs)('%s: no player-visible string reads as resume content', (packDir) => {
    const strings = visibleStrings(parsePack(packDir));
    expect(strings.length).toBeGreaterThan(0);
    const offenders = [];
    for (const { where, text } of strings) {
      for (const { name, re } of RESUME_PATTERNS) {
        if (re.test(text)) offenders.push(`${where}: "${text}" (${name})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(packs)(
    '%s: author-facing accomplishment notes never reach a visible string (DATA-FR-010)',
    (packDir) => {
      const docs = parsePack(packDir);
      const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
      const visible = visibleStrings(docs).map(({ where, text }) => ({
        where,
        text: normalize(text),
      }));
      const leaks = [];
      for (const [path, doc] of docs) {
        if (doc.schemaType !== 'metaphor' || typeof doc.accomplishment !== 'string') continue;
        const note = normalize(doc.accomplishment);
        for (const { where, text } of visible) {
          if (text.includes(note)) leaks.push(`${path} accomplishment appears in ${where}`);
        }
      }
      expect(leaks).toEqual([]);
    },
  );

  it('the scan catches resume-shaped text (the net is not vacuous)', () => {
    const resumeLines = [
      'Senior Engineer, 2015-2020',
      'View my resume and LinkedIn profile',
      'Over 12 years of experience leading teams',
      'References available upon request',
      'Full employment history inside',
      'Download CV',
    ];
    for (const line of resumeLines) {
      expect(
        RESUME_PATTERNS.some(({ re }) => re.test(line)),
        `expected a pattern to catch: ${line}`,
      ).toBe(true);
    }
  });
});
