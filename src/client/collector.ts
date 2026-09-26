import {
  type BrowserInfo,
  type MetricsBatch,
  PROTOCOL_VERSION,
  type RequestRecord,
} from '../shared/types.js';
import { collectBrowserInfo } from './browser-info.js';
import { ErrorBuffer, RingBuffer } from './buffer.js';
import type { CollectorConfig } from './config.js';
import { type CapturedError, instrumentErrors } from './instrument/errors.js';
import { getOriginalFetch, instrumentFetch } from './instrument/fetch.js';
import { instrumentXhr } from './instrument/xhr.js';
import { now } from './time.js';
import { createTransport, type Transport } from './transport.js';
import { matchesAny, normalizeUrl } from './url.js';

const MAX_BACKOFF_MS = 5 * 60_000;
const createSessionId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class Collector {
  readonly sessionId = createSessionId();
  private readonly requests: RingBuffer<RequestRecord>;
  private readonly errors: ErrorBuffer;
  private readonly transport: Transport;
  private readonly browser: BrowserInfo;
  private readonly teardown: (() => void)[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;
  private flushScheduled = false;
  private failures = 0;
  private retryAt = 0;

  constructor(
    readonly config: CollectorConfig,
    private readonly win: Window & typeof globalThis = window,
    transport?: Transport,
  ) {
    this.requests = new RingBuffer(config.maxBuffer);
    this.errors = new ErrorBuffer(config.maxBuffer);
    this.transport =
      transport ?? createTransport(config.endpoint, getOriginalFetch(win), win.navigator);
    this.browser = collectBrowserInfo(win);
  }

  start(): this {
    const { config, win } = this;
    const normalize = (url: string): string =>
      normalizeUrl(url, config.stripQuery, win.location.href);
    const shouldRecord = (url: string): boolean =>
      !(config.endpoint && url.startsWith(config.endpoint)) && !matchesAny(url, config.ignoreUrls);
    const onRequest = (record: RequestRecord): void => {
      this.requests.push(record);
      this.maybeFlush();
    };

    if (config.captureFetch) {
      this.teardown.push(instrumentFetch(win, onRequest, shouldRecord, normalize));
    }

    if (config.captureXhr) {
      this.teardown.push(instrumentXhr(win, onRequest, shouldRecord, normalize));
    }

    if (config.captureErrors) {
      this.teardown.push(
        instrumentErrors(win, (error) => this.recordError(error), config.captureConsoleErrors),
      );
    }

    this.timer = setInterval(() => void this.flush(), config.flushInterval);

    const onHidden = (): void => {
      if (win.document.visibilityState === 'hidden') {
        this.flushOnUnload();
      }
    };
    const onPageHide = (): void => this.flushOnUnload();

    win.document.addEventListener('visibilitychange', onHidden);
    win.addEventListener('pagehide', onPageHide);
    this.teardown.push(() => {
      win.document.removeEventListener('visibilitychange', onHidden);
      win.removeEventListener('pagehide', onPageHide);
    });

    this.log('started', config);

    return this;
  }

  stop(): void {
    clearInterval(this.timer);

    for (const undo of this.teardown.splice(0)) {
      undo();
    }

    this.flushOnUnload();
  }

  /** Public so microfrontends can report handled errors explicitly. */
  recordError(error: CapturedError): void {
    this.errors.push({ ...error, page: this.win.location.href }, now());
    this.maybeFlush();
  }

  get pending(): number {
    return this.requests.size + this.errors.size;
  }

  /** Sends one batch. Failed batches are put back in the buffers and retried with backoff. */
  async flush(): Promise<void> {
    if (this.flushing || this.pending === 0 || Date.now() < this.retryAt) {
      return;
    }

    this.flushing = true;
    const batch = this.takeBatch();

    try {
      if (await this.transport.send(batch)) {
        this.failures = 0;
        this.retryAt = 0;
      } else {
        this.requeue(batch);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Drains everything with `sendBeacon`, in batch-sized chunks to stay under the ~64KB limit. */
  flushOnUnload(): void {
    while (this.pending > 0) {
      this.transport.sendOnUnload(this.takeBatch());
    }
  }

  private maybeFlush(): void {
    if (this.flushScheduled || this.pending < this.config.batchSize) {
      return;
    }

    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      void this.flush();
    });
  }

  private takeBatch(): MetricsBatch {
    const { batchSize, app, env } = this.config;
    const errors = this.errors.drain(batchSize);
    const requests = this.requests.drain(batchSize - errors.length);

    this.seq += 1;

    return {
      v: PROTOCOL_VERSION,
      app,
      env,
      sessionId: this.sessionId,
      seq: this.seq,
      page: this.win.location.href,
      sentAt: Date.now(),
      browser: this.browser,
      requests,
      errors,
      dropped: { requests: this.requests.takeDropped(), errors: this.errors.takeDropped() },
    };
  }

  private requeue(batch: MetricsBatch): void {
    for (const record of batch.requests) {
      this.requests.push(record);
    }

    for (const error of batch.errors) {
      this.errors.restore(error);
    }

    this.failures += 1;
    const backoff = Math.min(this.config.flushInterval * 2 ** this.failures, MAX_BACKOFF_MS);

    this.retryAt = Date.now() + backoff;
    this.log(`delivery failed, retrying in ${backoff}ms`);
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.debug('[metrics-collector]', ...args);
    }
  }
}
