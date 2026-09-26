import { createEslintConfig } from 'super-configs/eslint';

export default createEslintConfig({
  runtime: 'node',
  language: 'ts',
  typeChecked: true,
  testFramework: 'vitest',
  ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  overrides: [
    {
      // Tests compare and restore native methods such as `window.fetch` by reference.
      files: ['**/*.test.ts'],
      rules: { '@typescript-eslint/unbound-method': 'off' },
    },
  ],
});
