import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Router } from 'express';
import type { MetricsBatch } from '../shared/types.js';
import { createHtmlInjector, INJECT_MARKER } from './inject.js';
import { isMetricsBatch } from './validate.js';

export type { BrowserInfo, ErrorRecord, MetricsBatch, RequestRecord } from '../shared/types.js';
export { injectTag } from './inject.js';
export { isMetricsBatch } from './validate.js';

export type BatchHandler = (batch: MetricsBatch, req: Request) => void | Promise<void>;

/** Options forwarded to the browser through the script URL query string. */
export interface ClientOptions {
  /** Where the browser sends batches. Defaults to this middleware's ingest route. */
  endpoint?: string;
  app?: string;
  env?: string;
  batchSize?: number;
  flushInterval?: number;
  maxBuffer?: number;
  sampleRate?: number;
  fetch?: boolean;
  xhr?: boolean;
  errors?: boolean;
  console?: boolean;
  stripQuery?: boolean;
  /** Substrings; requests whose URL contains any of them are not recorded. */
  ignore?: string[];
  debug?: boolean;
}

export interface MetricsCollectorOptions {
  /** Master switch. Default: `NODE_ENV !== 'production'`. */
  enabled?: boolean;
  /** Mount path for the script and ingest routes. Default: `/__metrics`. */
  basePath?: string;
  /** Inject the `<script>` tag into HTML responses. Default: `true`. */
  inject?: boolean;
  /**
   * `module` is `<script type="module">` (deferred). `classic` runs synchronously in `<head>`
   * and therefore catches requests and errors from the very first script. Default: `module`.
   */
  scriptType?: 'module' | 'classic';
  /** Absolute URL the script is loaded from, for serving it from a CDN/other host. */
  scriptUrl?: string;
  client?: ClientOptions;
  /**
   * Receives each batch posted to `<basePath>/ingest`. `false` disables the route (use it when
   * `client.endpoint` points to an external service). Default: logs a one-line summary.
   */
  onBatch?: BatchHandler | false;
  /** Max accepted body size for the ingest route. Default: `256kb`. */
  maxBodySize?: string | number;
  /** Directory holding the built browser bundles. Default: the package's `dist/browser`. */
  bundleDir?: string;
}

const MODULE_FILE = 'collector.js';
const CLASSIC_FILE = 'collector.classic.js';
const defaultBundleDir = (): string => fileURLToPath(new URL('../browser/', import.meta.url));
const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const logBatchSummary: BatchHandler = (batch) => {
  const failed = batch.requests.filter(([, , status]) => status === 0 || status >= 400).length;

  console.info(
    `[metrics] ${batch.app}#${batch.seq} ${batch.sessionId.slice(0, 8)} ` +
      `requests=${batch.requests.length} (failed=${failed}) errors=${batch.errors.length} ` +
      `dropped=${batch.dropped.requests + batch.dropped.errors}`,
  );
};

export const buildQuery = (client: ClientOptions): string => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(client)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      params.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      params.set(key, value ? '1' : '0');
    } else {
      params.set(key, String(value));
    }
  }

  return params.toString();
};

/**
 * Express router that serves the browser collector, injects it into HTML pages and
 * (optionally) receives the batches.
 *
 * ```ts
 * app.use(metricsCollector({ client: { app: 'shell', env: 'qa' } }));
 * app.use(express.static('public'));
 * ```
 */
export const metricsCollector = (options: MetricsCollectorOptions = {}): Router => {
  const {
    enabled = process.env.NODE_ENV !== 'production',
    basePath = '/__metrics',
    inject = true,
    scriptType = 'module',
    onBatch = logBatchSummary,
    maxBodySize = '256kb',
    bundleDir = defaultBundleDir(),
  } = options;
  const router = express.Router();

  if (!enabled) {
    return router;
  }

  const ingestPath = `${basePath}/ingest`;
  const client: ClientOptions = { endpoint: onBatch ? ingestPath : undefined, ...options.client };

  if (!client.endpoint) {
    throw new Error('metricsCollector: set `client.endpoint` when `onBatch` is false.');
  }

  const file = scriptType === 'classic' ? CLASSIC_FILE : MODULE_FILE;

  if (!options.scriptUrl && !existsSync(join(bundleDir, file))) {
    throw new Error(
      `metricsCollector: browser bundle not found in ${bundleDir}. Run "npm run build".`,
    );
  }

  const src = `${options.scriptUrl ?? `${basePath}/${file}`}?${buildQuery(client)}`;
  const tag =
    scriptType === 'classic'
      ? `<script ${INJECT_MARKER} src="${escapeAttribute(src)}"></script>`
      : `<script ${INJECT_MARKER} type="module" src="${escapeAttribute(src)}"></script>`;

  // Cross-origin module scripts and beacons from other microfrontend hosts need CORS.
  router.use(basePath, (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  router.use(
    basePath,
    express.static(bundleDir, {
      index: false,
      maxAge: '5m',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  if (onBatch) {
    router.options(ingestPath, (_req, res) => {
      res.sendStatus(204);
    });
    router.post(ingestPath, express.text({ type: '*/*', limit: maxBodySize }), async (req, res) => {
      let batch: unknown;

      try {
        batch = JSON.parse(typeof req.body === 'string' ? req.body : '');
      } catch {
        res.status(400).json({ error: 'invalid JSON' });

        return;
      }

      if (!isMetricsBatch(batch)) {
        res.status(422).json({ error: 'invalid batch' });

        return;
      }

      try {
        await onBatch(batch, req);
        res.sendStatus(204);
      } catch (error) {
        console.error('[metrics] onBatch failed', error);
        res.sendStatus(500);
      }
    });
  }

  if (inject) {
    router.use(createHtmlInjector(() => tag));
  }

  return router;
};

export default metricsCollector;
