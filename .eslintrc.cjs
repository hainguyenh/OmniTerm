module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Allow underscore-prefixed unused vars / args / caught-errors and rest-destructure
    // siblings (e.g. `const { hasPassword: _hp, ...rest } = obj` to strip a field).
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'no-empty': 'off',
    'no-control-regex': 'off',
    // A packaged build reports nothing about itself, and that cannot be enforced by the bundler:
    // Vite 8 minifies with Oxc, which silently ignores esbuild's `drop: ['console']`. So app code
    // must not call console at all — route diagnostics through `diag` (src/diag.ts), which is a set
    // of no-ops outside a dev build.
    'no-console': 'error',
  },
  overrides: [
    {
      // diag.ts owns the only console references in the app: the dev-build sink and the packaged-build
      // shutdown. Test helpers may report freely — they never ship.
      files: ['src/diag.ts', 'src/testSetup.ts', 'src/testUtils.tsx', '**/__tests__/**'],
      rules: { 'no-console': 'off' },
    },
  ],
}
