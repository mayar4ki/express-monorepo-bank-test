// @ts-check
import { baseConfig } from '@bank/eslint-config/base';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
];
