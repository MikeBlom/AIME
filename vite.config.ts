import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so one built artifact serves any mount point — a site
  // root, a project-pages subpath, or a per-PR preview directory (docs/42).
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    // Coverage gates (issue #43, docs/41-Testing-Strategy.md): thresholds
    // hold the engine's safety net at its current strength — a change that
    // drops below them fails `npm run test` locally and in CI alike. Ratchet
    // them up as coverage grows; never lower them to admit a change.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 87,
      },
    },
  },
});
