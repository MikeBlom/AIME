import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    rules: {
      // Systems talk via the event bus and world state, never console noise.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // CLI gate tools, not engine code: they run under Node and talk to stdout.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
);
