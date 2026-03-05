import tseslint from 'typescript-eslint';

export default tseslint.config(
  tseslint.configs.recommended,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'keys/'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/subtensor/**/*.ts', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
