import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['.wxt/**', '.output/**', 'node_modules/**', 'tests/fixtures/**'] },
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error', 'no-console': 'error' } },
);
