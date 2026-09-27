// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricsBatch } from '../shared/types.js';
import { Collector } from './collector.js';
import { type CollectorConfig, resolveConfig } from './config.js';
import { Presence } from './presence.js';
import type { Transport } from './transport.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
const createTransport = (ok = true) => {
  const sent: MetricsBatch[] = [];
  const beacons: MetricsBatch[] = [];
  const transport: Transport = {
    send: vi.fn((batch: MetricsBatch) => {
      sent.push(batch);

      return Promise.resolve(ok);
    }),
    sendOnUnload: vi.fn((batch: MetricsBatch) => {
      beacons.push(batch);

      return true;
    }),
  };

  return { transport, sent, beacons };
};

describe('Collector', () => {
  const originalFetch = window.fetch;

  let collector: Collector | undefined;

  const start = (overrides: Partial<CollectorConfig> = {}, ok = true) => {
    const transportMock = createTransport(ok);
    const config = resolveConfig(undefined, {
      endpoint: 'https://metrics.test/ingest',
      app: 'shell',
      captureNavigation: false,
      ...overrides,
    });

    collector = new Collector(
      config,
      window,
      transportMock.transport,
      new Presence(window, null),
    ).start();

    return transportMock;
  };

  beforeEach(() => {
    window.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.includes('fail')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }

      return Promise.resolve(new Response('{}', { status: url.includes('missing') ? 404 : 200 }));
    });
  });

  afterEach(() => {
    collector?.stop();
    collector = undefined;
    window.fetch = originalFetch;
  });

  it('records fetch requests as [method, url, status, start, end] tuples', async () => {
    const { sent } = start({ batchSize: 3 });

    await window.fetch('/api/users?page=2');
    await window.fetch(new Request('https://remote.mfe/data', { method: 'post' }));
    await window.fetch('/missing', { method: 'DELETE' });
    await flushMicrotasks();

    expect(sent).toHaveLength(1);
    const [batch] = sent;

    expect(batch?.requests.map(([method, url, status]) => [method, url, status])).toEqual([
      ['GET', `${location.origin}/api/users`, 200],
      ['POST', 'https://remote.mfe/data', 200],
      ['DELETE', `${location.origin}/missing`, 404],
    ]);

    for (const [, , , startTime, end] of batch?.requests ?? []) {
      expect(end).toBeGreaterThanOrEqual(startTime);
    }

    expect(batch).toMatchObject({ v: 2, app: 'shell', seq: 1 });
    expect(batch?.browser.userAgent).toEqual(expect.any(String));
  });

  it('records network failures with status 0 and rethrows', async () => {
    const { beacons } = start();

    await expect(window.fetch('/fail')).rejects.toThrow('Failed to fetch');
    collector?.flushOnUnload();

    expect(beacons[0]?.requests[0]).toEqual([
      'GET',
      `${location.origin}/fail`,
      0,
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('does not record its own endpoint or ignored URLs', async () => {
    const { beacons } = start({ ignoreUrls: ['/health'] });

    await window.fetch('https://metrics.test/ingest');
    await window.fetch('/health');
    await window.fetch('/api');
    collector?.flushOnUnload();

    expect(beacons.flatMap((b) => b.requests.map(([, url]) => url))).toEqual([
      `${location.origin}/api`,
    ]);
  });

  it('captures and deduplicates errors and unhandled rejections', () => {
    const { beacons } = start();
    const error = new Error('kaput');

    window.dispatchEvent(
      new ErrorEvent('error', {
        error,
        message: error.message,
        filename: 'https://mfe/app.js',
        lineno: 3,
      }),
    );
    window.dispatchEvent(
      new ErrorEvent('error', {
        error,
        message: error.message,
        filename: 'https://mfe/app.js',
        lineno: 3,
      }),
    );
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown };

    rejection.reason = 'nope';
    window.dispatchEvent(rejection);
    collector?.flushOnUnload();

    expect(beacons[0]?.errors).toEqual([
      expect.objectContaining({
        kind: 'error',
        message: 'Error: kaput',
        source: 'https://mfe/app.js',
        line: 3,
        count: 2,
      }),
      expect.objectContaining({ kind: 'rejection', message: 'nope', count: 1 }),
    ]);
  });

  it('reports failed asset loads as resource errors', () => {
    const { beacons } = start();
    const image = document.createElement('img');

    image.src = 'https://remote.mfe/logo.png';
    document.body.append(image);
    image.dispatchEvent(new Event('error'));
    collector?.flushOnUnload();

    expect(beacons[0]?.errors[0]).toMatchObject({
      kind: 'resource',
      message: 'Failed to load <img>',
      source: 'https://remote.mfe/logo.png',
    });
  });

  it('puts records back and backs off when delivery fails', async () => {
    const { sent } = start({ batchSize: 1 }, false);

    await window.fetch('/api');
    await flushMicrotasks();
    expect(sent).toHaveLength(1);
    expect(collector?.pending).toBe(1);

    await collector?.flush();
    expect(sent).toHaveLength(1);
  });

  it('splits the unload flush into batch-sized chunks', async () => {
    const { beacons, sent } = start({ batchSize: 2, flushInterval: 60_000 });

    // Simulate a delivery backlog: records accumulate while the regular flush is backing off.
    vi.spyOn(collector as Collector, 'flush').mockResolvedValue();

    for (let i = 0; i < 5; i += 1) {
      await window.fetch(`/api/${i}`);
    }

    collector?.flushOnUnload();

    expect(sent).toHaveLength(0);
    expect(beacons.map((b) => b.requests.length)).toEqual([2, 2, 1]);
    expect(beacons.map((b) => b.seq)).toEqual([1, 2, 3]);
  });

  it('identifies the client, tab and page load in every batch', async () => {
    const { sent } = start({ batchSize: 1 });

    await window.fetch('/api');
    await flushMicrotasks();

    const { identity } = (collector as Collector).presence;

    expect(sent[0]).toMatchObject({
      clientId: identity.clientId,
      tabId: identity.tabId,
      loadId: identity.loadId,
    });
    expect(typeof sent[0]?.visible).toBe('boolean');
  });

  it('records the initial URL and SPA route changes, skipping repeats', () => {
    history.replaceState(null, '', '/');
    const { beacons } = start({ captureNavigation: true });

    history.pushState(null, '', '/login?token=secret');
    history.replaceState(null, '', '/login?token=secret');
    history.pushState(null, '', '/home');
    collector?.flushOnUnload();

    expect(beacons[0]?.navigations.map(([url]) => url)).toEqual([
      `${location.origin}/`,
      `${location.origin}/login`,
      `${location.origin}/home`,
    ]);
  });

  it('sends an empty heartbeat on each tick, but not on a plain flush', async () => {
    const { sent } = start();

    await collector?.flush();
    expect(sent).toHaveLength(0);

    await collector?.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ requests: [], errors: [], navigations: [] });
  });

  it('skips the heartbeat when disabled', async () => {
    const { sent } = start({ heartbeat: false });

    await collector?.tick();
    expect(sent).toHaveLength(0);
  });

  it('marks only the last unload chunk as final, even when nothing is pending', async () => {
    const { beacons } = start({ batchSize: 1 });

    vi.spyOn(collector as Collector, 'flush').mockResolvedValue();
    await window.fetch('/a');
    await window.fetch('/b');
    collector?.flushOnUnload(true);

    expect(beacons.map((b) => b.final)).toEqual([undefined, true]);

    collector?.flushOnUnload(true);
    expect(beacons[2]).toMatchObject({ requests: [], final: true });
  });

  it('does not close the page load when it enters the back/forward cache', () => {
    const { beacons } = start();
    const pageHide = (persisted: boolean) =>
      Object.assign(new Event('pagehide'), { persisted }) as PageTransitionEvent;

    window.dispatchEvent(pageHide(true));
    expect(beacons).toHaveLength(0);

    window.dispatchEvent(pageHide(false));
    expect(beacons[0]?.final).toBe(true);
  });

  it('restores the original fetch on stop', () => {
    const before = window.fetch;

    start();
    expect(window.fetch).not.toBe(before);
    collector?.stop();
    expect(window.fetch).toBe(before);
  });
});
