import sharedConfig from 'super-configs/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      coverage: { include: ['src/**/*.ts'] },
    },
  }),
);
