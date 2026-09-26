import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, GLOBAL_CONFIG_KEY, parseQueryConfig, resolveConfig } from './config.js';

describe('parseQueryConfig', () => {
  it('reads typed options from the script URL', () => {
    const config = parseQueryConfig(
      'https://host/lib/collector.js?endpoint=/ingest&app=shell&batchSize=20&xhr=0&console=1&ignore=/health,hot-update',
    );

    expect(config).toEqual({
      endpoint: '/ingest',
      app: 'shell',
      batchSize: 20,
      captureXhr: false,
      captureConsoleErrors: true,
      ignoreUrls: ['/health', 'hot-update'],
    });
  });

  it('ignores invalid numbers and URLs', () => {
    expect(parseQueryConfig('https://host/c.js?batchSize=abc')).toEqual({});
    expect(parseQueryConfig('not a url')).toEqual({});
  });
});

describe('resolveConfig', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[GLOBAL_CONFIG_KEY];
  });

  it('resolves a relative endpoint against the script URL', () => {
    const config = resolveConfig('https://cdn.example.com/metrics/collector.js?endpoint=ingest');

    expect(config.endpoint).toBe('https://cdn.example.com/metrics/ingest');
  });

  it('lets the global config and explicit overrides win over the query', () => {
    (globalThis as Record<string, unknown>)[GLOBAL_CONFIG_KEY] = { app: 'from-global', env: 'qa' };
    const config = resolveConfig('https://h/c.js?endpoint=https://api/x&app=from-query', {
      env: 'dev',
    });

    expect(config).toMatchObject({ app: 'from-global', env: 'dev' });
  });

  it('clamps out-of-range values', () => {
    const config = resolveConfig(undefined, {
      batchSize: 0,
      sampleRate: 3,
      flushInterval: 1,
      maxBuffer: 1,
    });

    expect(config).toMatchObject({
      batchSize: 1,
      sampleRate: 1,
      flushInterval: 1_000,
      maxBuffer: 1,
    });
    expect(resolveConfig().batchSize).toBe(DEFAULT_CONFIG.batchSize);
  });
});
