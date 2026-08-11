import js from '@eslint/js';

export default [
  {
    ignores: ['node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
];
