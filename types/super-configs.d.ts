// super-configs exports its Vitest preset as plain JS without declarations.
declare module 'super-configs/vitest' {
  import type { ViteUserConfig } from 'vitest/config';

  const config: ViteUserConfig;

  export default config;
}
