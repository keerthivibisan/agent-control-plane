// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Package dependency directions (see docs/architecture.md and ADR-0002).
 * Each entry lists the workspace packages a package must NOT import.
 */
const forbiddenImports = {
  'packages/core/**': ['@acp/db', '@acp/server', '@acp/web', '@acp/adapter-*'],
  'packages/db/**': ['@acp/server', '@acp/web', '@acp/adapter-*'],
  'packages/adapters/**': ['@acp/db', '@acp/server', '@acp/web'],
  'packages/server/**': ['@acp/web', '@acp/adapter-demo/fixtures/*'],
  'packages/web/**': ['@acp/db', '@acp/server', '@acp/adapter-*'],
};

const boundaryConfigs = Object.entries(forbiddenImports).map(([files, group]) => ({
  files: [files],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group,
            message: 'Forbidden by package dependency direction rules (docs/architecture.md).',
          },
        ],
      },
    ],
  },
}));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'test-fixtures/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  ...boundaryConfigs,
);
