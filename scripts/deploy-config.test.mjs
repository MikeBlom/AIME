/**
 * Deployment-config guard rails (issue #41; docs/42-Deployment-and-Hosting.md).
 * The deploy pipeline is configuration, so its load-bearing properties are
 * pinned by test: the artifact stays relocatable (FR-DEP-002), the workflow
 * ships only from green main plus same-repo PR previews (FR-DEP-003/005),
 * fork tokens never write the site branch, and Pages serves files verbatim.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

describe('the built artifact is relocatable (FR-DEP-002)', () => {
  it('vite builds with a relative base so root and preview mounts share one build', () => {
    expect(viteConfig).toContain("base: './'");
  });
});

describe('the deploy workflow (FR-DEP-003..006)', () => {
  it('deploys main pushes and previews pull requests', () => {
    expect(workflow).toContain('push:');
    expect(workflow).toContain('branches: [main]');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain("format('previews/pr-{0}', github.event.pull_request.number)");
  });

  it('never lets a fork PR write the site branch', () => {
    expect(workflow).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
  });

  it('holds the minimum token scope and serializes gh-pages pushes', () => {
    expect(workflow).toContain('permissions:\n  contents: write');
    expect(workflow).toContain('group: gh-pages-publish');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('preserves previews on root deploys and serves files verbatim', () => {
    expect(workflow).toContain("-not -name 'previews'");
    expect(workflow).toContain('touch site/.nojekyll');
  });
});
