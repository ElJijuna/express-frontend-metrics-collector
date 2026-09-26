import type { MetricsBatch } from '../shared/types.js';

/**
 * `text/plain` is a CORS-safelisted content type: it avoids a preflight request and is the
 * only way `sendBeacon` can post cross-origin. The ingest endpoint parses it as JSON.
 */
const CONTENT_TYPE = 'text/plain;charset=UTF-8';

export interface Transport {
  /** Regular delivery; resolves `false` on failure so the caller can retry. */
  send(batch: MetricsBatch): Promise<boolean>;
  /** Fire-and-forget delivery that survives page unload. */
  sendOnUnload(batch: MetricsBatch): boolean;
}

export const createTransport = (
  endpoint: string,
  fetchImpl: typeof fetch,
  nav: Navigator = navigator,
): Transport => {
  const post = async (body: string): Promise<boolean> => {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': CONTENT_TYPE },
        keepalive: true,
        credentials: 'omit',
      });

      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    send: (batch) => post(JSON.stringify(batch)),

    sendOnUnload(batch) {
      const body = JSON.stringify(batch);

      if (typeof nav.sendBeacon === 'function') {
        try {
          if (nav.sendBeacon(endpoint, new Blob([body], { type: CONTENT_TYPE }))) {
            return true;
          }
        } catch {
          // Fall through to keepalive fetch.
        }
      }

      void post(body);

      return true;
    },
  };
};
