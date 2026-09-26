import { now } from '../time.js';
import type { RequestFilter, RequestListener, UrlNormalizer } from './fetch.js';

interface XhrState {
  method: string;
  url: string;
}

/**
 * Many microfrontends use axios or older SDKs that go through XMLHttpRequest instead of
 * fetch; without this they would be invisible. Records the same tuple as fetch.
 */
export const instrumentXhr = (
  target: { XMLHttpRequest?: typeof XMLHttpRequest },
  onRequest: RequestListener,
  shouldRecord: RequestFilter,
  normalize: UrlNormalizer,
): (() => void) => {
  const Xhr = target.XMLHttpRequest;

  if (!Xhr) {
    return () => {};
  }

  const proto = Xhr.prototype;
  // Kept unbound on purpose: they are re-invoked with each XHR instance as `this` and restored on teardown.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalOpen = proto.open;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalSend = proto.send;
  const state = new WeakMap<XMLHttpRequest, XhrState>();

  proto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    state.set(this, { method: method.toUpperCase(), url: normalize(String(url)) });

    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const info = state.get(this);

    if (info && shouldRecord(info.url)) {
      const start = now();

      this.addEventListener(
        'loadend',
        () => {
          onRequest([info.method, info.url, this.status, start, now()]);
        },
        { once: true },
      );
    }

    return originalSend.call(this, body);
  };

  return () => {
    proto.open = originalOpen;
    proto.send = originalSend;
  };
};
