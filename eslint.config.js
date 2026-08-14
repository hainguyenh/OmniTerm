import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist',
      '**/dist/**',
      '.omniterm-build',
      '**/.omniterm-build/**',
      'artifacts',
      '**/artifacts/**',
      'coverage-js',
      '**/coverage-js/**',
      'coverage-rust',
      '**/coverage-rust/**',
      'target',
      '**/target/**',
      'node_modules',
      '**/node_modules/**',
      '.pnpm-store',
      '**/.pnpm-store/**',
      'plugins/markdown-explorer',
    ],
  },
  { ...js.configs.recommended, files: ['**/*.{ts,tsx}'] },
  ...tseslint.configs['flat/recommended'].map(config => ({
    ...config,
    files: config.files ?? ['**/*.{ts,tsx,mts,cts}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2020 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': 'off',
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      // Keep diagnostics out of packaged renderer code; use ui/diag.ts instead.
      'no-console': 'error',
    },
  },
  {
    files: ['ui/diag.ts', 'ui/testSetup.ts', 'ui/testUtils.tsx', '**/__tests__/**'],
    rules: { 'no-console': 'off' },
  },
]
