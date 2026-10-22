import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default tseslint.config(
  // ── Ignored paths ──────────────────────────────────────────────────────────
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      '*.config.js',       // postcss.config.js, jest.config.ts excluded below
      'next.config.mjs',
      'next-env.d.ts',
      'tailwind.config.ts',
      'jest.config.ts',
    ],
  },

  // ── next-config-next (legacy config via compat shim) ───────────────────────
  // eslint-config-next hasn't fully migrated to flat config yet; use
  // @eslint/eslintrc's FlatCompat wrapper to bridge it.
  ...compat.extends('next/core-web-vitals'),

  // ── TypeScript-aware rules for all TS/TSX source files ─────────────────────
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // ── TypeScript ──────────────────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Allow empty catch blocks used for intentional no-ops
      '@typescript-eslint/no-empty-function': ['warn', { allow: ['arrowFunctions'] }],

      // ── General quality ─────────────────────────────────────────────────────
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ── Relax rules in test files ───────────────────────────────────────────────
  {
    files: ['src/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': 'off',
    },
  },
);
