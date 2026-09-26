// Bundles the browser collector into self-contained files served by the Express middleware.
import { build } from 'esbuild';

const shared = {
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
  legalComments: 'none',
  logLevel: 'info',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/client/index.ts'],
    format: 'esm',
    outfile: 'dist/browser/collector.js',
  }),
  build({
    ...shared,
    entryPoints: ['src/client/classic.ts'],
    format: 'iife',
    outfile: 'dist/browser/collector.classic.js',
  }),
]);
