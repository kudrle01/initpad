import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['apps/{api,agent}/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/api/src/generated/**',
      'deploy/**',
      'templates/**',
    ],
  },
  {
    files: ['eslint.config.mjs', 'scripts/**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: sourceFiles,
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            // React intentionally ignores event-handler return values. Async
            // handlers remain linted internally for floating promises.
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['apps/{api,agent}/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/api/src/**/*.spec.ts'],
    languageOptions: {
      globals: globals.jest,
    },
  },
  {
    // Test registration and mock callbacks intentionally use promises and
    // partial dynamic objects. They still receive the syntax/recommended TS
    // rules, while non-test application code remains fully type-aware.
    files: ['apps/**/*.spec.ts', 'apps/**/*.test.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      // Test doubles often model deliberately partial framework/Prisma shapes.
      // Production source keeps the rule enabled and type-aware.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
