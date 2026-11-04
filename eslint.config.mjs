import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
    files: [
      'scripts/**/*.mjs',
      'tests/**/*.mjs',
      'zink-skill-store/**/*.mjs',
      'zink-tools/**/*.mjs',
      'integrations/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
      },
    },
  },
];
