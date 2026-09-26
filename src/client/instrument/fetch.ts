import type { RequestRecord } from '../../shared/types.js';
import { now } from '../time.js';

export type RequestListener = (record: RequestRecord) => void;
export type RequestFilter = (url: string) => boolean;
export type UrlNormalizer = (url: string) => string;

const INSTRUMENTED = Symbol.for('metrics-collector.fetch');

type InstrumentedFetch = typeof fetch & { [INSTRUMENTED]?: typeof fetch };

const describeInput = (
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; url: string } => {
  if (typeof input === 'string' || input instanceof URL) {
    return { method: (init?.method ?? 'GET').toUpperCase(), url: String(input) };
  }

  return { method: (init?.method ?? input.method).toUpperCase(), url: input.url };
};

/**
 * Wraps `target.fetch`. `end` is recorded when the response headers arrive (the moment
 * the fetch promise resolves), not when the body finishes streaming.
 * Returns a function that restores the original implementation.
 */
export const instrumentFetch = (
  target: { fetch: typeof fetch },
  onRequest: RequestListener,
  shouldRecord: RequestFilter,
  normalize: UrlNormalizer,
): (() => void) => {
  const current = target.fetch as InstrumentedFetch | undefined;

  if (typeof current !== 'function' || current[INSTRUMENTED]) {
    return () => {};
  }

  const original = current;
  const wrapped: InstrumentedFetch = async (input, init) => {
    const { method, url } = describeInput(input, init);
    const absolute = normalize(url);

    if (!shouldRecord(absolute)) {
      return original.call(target, input, init);
    }

    const start = now();

    try {
      const response = await original.call(target, input, init);

      onRequest([method, absolute, response.status, start, now()]);

      return response;
    } catch (error) {
      onRequest([method, absolute, 0, start, now()]);

      throw error;
    }
  };

  wrapped[INSTRUMENTED] = original;
  target.fetch = wrapped;

  return () => {
    if (target.fetch === wrapped) {
      target.fetch = original;
    }
  };
};

/** Returns the un-instrumented fetch so the collector never records its own traffic. */
export const getOriginalFetch = (target: { fetch: typeof fetch }): typeof fetch => {
  const current = target.fetch as InstrumentedFetch;

  return (current[INSTRUMENTED] ?? current).bind(target);
};
