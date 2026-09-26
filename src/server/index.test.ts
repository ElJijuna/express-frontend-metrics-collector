import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricsBatch } from '../shared/types.js';
import { type MetricsCollectorOptions, metricsCollector } from './index.js';
import { injectTag } from './inject.js';

const bundleDir = mkdtempSync(join(tmpdir(), 'metrics-bundle-'));

writeFileSync(join(bundleDir, 'collector.js'), 'export {};');
writeFileSync(join(bundleDir, 'collector.classic.js'), ';');

const publicDir = mkdtempSync(join(tmpdir(), 'metrics-public-'));

writeFileSync(
  join(publicDir, 'index.html'),
  '<!doctype html><html><head><title>x</title></head><body></body></html>',
);

const batch: MetricsBatch = {
  v: 1,
  app: 'shell',
  sessionId: 'abc',
  seq: 1,
  page: 'http://localhost/',
  sentAt: 0,
  browser: {
    userAgent: 'ua',
    language: 'es',
    timezone: 'UTC',
    screen: '1x1',
    viewport: '1x1',
    pixelRatio: 1,
  },
  requests: [['GET', 'http://localhost/api', 200, 1, 2]],
  errors: [],
  dropped: { requests: 0, errors: 0 },
};

let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;

const listen = async (options: MetricsCollectorOptions) => {
  const app = express();

  app.use(metricsCollector({ enabled: true, bundleDir, ...options }));
  app.get('/ssr', (_req, res) => {
    res.send('<html><head></head><body>ssr</body></html>');
  });
  app.get('/json', (_req, res) => {
    res.json({ html: '<head></head>' });
  });
  app.use(express.static(publicDir));
  server = app.listen(0);
  await new Promise((resolve) => server?.once('listening', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

afterEach(() => {
  server?.close();
});

describe('injectTag', () => {
  it('inserts right after the opening <head> tag', () => {
    expect(
      injectTag('<html><head lang="x"><title/></head></html>', '<s data-metrics-collector>'),
    ).toBe('<html><head lang="x"><s data-metrics-collector><title/></head></html>');
  });

  it('keeps <meta charset> first', () => {
    expect(injectTag('<head><meta charset="utf-8"><title/></head>', '<s>')).toBe(
      '<head><meta charset="utf-8"><s><title/></head>',
    );
  });

  it('falls back to <body> and is idempotent', () => {
    const once = injectTag('<body>x</body>', '<s data-metrics-collector>');

    expect(once).toBe('<s data-metrics-collector><body>x</body>');
    expect(injectTag(once, '<s data-metrics-collector>')).toBe(once);
    expect(injectTag('plain text', '<s>')).toBe('plain text');
  });
});

describe('metricsCollector', () => {
  it('injects a module script into static and rendered HTML', async () => {
    const base = await listen({ client: { app: 'shell', env: 'qa', xhr: false } });

    for (const path of ['/', '/ssr']) {
      const response = await fetch(`${base}${path}`, { headers: { accept: 'text/html' } });
      const html = await response.text();

      expect(html).toContain(
        '<head><script data-metrics-collector type="module" src="/__metrics/collector.js?endpoint=%2F__metrics%2Fingest&amp;app=shell&amp;env=qa&amp;xhr=0"></script>',
      );
      expect(Number(response.headers.get('content-length'))).toBe(Buffer.byteLength(html));
    }
  });

  it('does not touch non-HTML responses', async () => {
    const base = await listen({});
    const response = await fetch(`${base}/json`);

    expect(await response.json()).toEqual({ html: '<head></head>' });
  });

  it('injects a classic script pointing to an external host when configured', async () => {
    const base = await listen({
      scriptType: 'classic',
      scriptUrl: 'https://cdn.test/collector.classic.js',
      onBatch: false,
      client: { endpoint: 'https://collector.test/v1' },
    });
    const html = await (await fetch(`${base}/ssr`)).text();

    expect(html).toContain(
      '<script data-metrics-collector src="https://cdn.test/collector.classic.js?endpoint=https%3A%2F%2Fcollector.test%2Fv1"></script>',
    );
  });

  it('serves the bundle with CORS headers', async () => {
    const base = await listen({});
    const response = await fetch(`${base}/__metrics/collector.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(await response.text()).toBe('export {};');
  });

  it('accepts text/plain batches and hands them to onBatch', async () => {
    const onBatch = vi.fn();
    const base = await listen({ onBatch });
    const response = await fetch(`${base}/__metrics/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(batch),
    });

    expect(response.status).toBe(204);
    expect(onBatch).toHaveBeenCalledWith(batch, expect.anything());
  });

  it('rejects malformed batches', async () => {
    const onBatch = vi.fn();
    const base = await listen({ onBatch });
    const post = (body: string) => fetch(`${base}/__metrics/ingest`, { method: 'POST', body });

    expect((await post('nope')).status).toBe(400);
    expect((await post(JSON.stringify({ ...batch, requests: [['GET']] }))).status).toBe(422);
    expect(onBatch).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const app = express();

    app.use(metricsCollector({ enabled: false, bundleDir }));
    app.use(express.static(publicDir));
    server = app.listen(0);
    await new Promise((resolve) => server?.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    expect(await (await fetch(`${base}/`)).text()).not.toContain('data-metrics-collector');
    expect((await fetch(`${base}/__metrics/collector.js`)).status).toBe(404);
  });

  it('fails fast when the browser bundle is missing', () => {
    expect(() => metricsCollector({ enabled: true, bundleDir: '/nonexistent' })).toThrow(
      'npm run build',
    );
  });
});
