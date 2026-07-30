import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// A CORRECTNESS gate, not a style linter. The rule set is deliberately
// tiny: React's hook rules catch a class of bug TypeScript cannot see
// (stale closures from an incomplete dependency array), which is exactly
// what App.tsx's editing pipeline is exposed to. Formatting and general
// TS style are left alone on purpose — adding them would bury the
// signal this config exists to surface.
export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    // Because the enabled rule set is intentionally tiny, every
    // `eslint-disable` naming a rule this config does NOT enable reads as
    // "unused". Those directives are correct in intent (they guard
    // against style rules a fuller config would add) — reporting them
    // here would be an artefact of the narrow scope, not a real finding.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    files: ['packages/editor/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
