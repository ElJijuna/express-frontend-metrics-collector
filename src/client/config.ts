export type UrlMatcher = string | RegExp;

export interface CollectorConfig {
  /** Where batches are POSTed. Relative URLs resolve against the script URL. */
  endpoint: string;
  /** Logical application name used to group data in the backend. */
  app: string;
  env?: string;
  /** Flush as soon as this many records are buffered. */
  batchSize: number;
  /** Periodic flush interval in ms. */
  flushInterval: number;
  /** Max records kept in memory per kind; oldest are dropped beyond this. */
  maxBuffer: number;
  /** Fraction of page loads that are collected (0..1). */
  sampleRate: number;
  captureFetch: boolean;
  captureXhr: boolean;
  captureErrors: boolean;
  captureConsoleErrors: boolean;
  /**
   * Send a batch every `flushInterval` even when empty, so the backend knows the client is
   * alive. With Web Locks only the leader tab heartbeats, carrying the list of open tabs.
   */
  heartbeat: boolean;
  /** Record SPA route changes (`pushState`, `replaceState`, `popstate`, `hashchange`). */
  captureNavigation: boolean;
  /** Remove query string and hash from recorded URLs (privacy + lower cardinality). */
  stripQuery: boolean;
  /** Requests whose URL matches are not recorded. Strings match as substrings. */
  ignoreUrls: UrlMatcher[];
  debug: boolean;
}

export const DEFAULT_CONFIG: CollectorConfig = {
  endpoint: '',
  app: 'unknown',
  batchSize: 50,
  flushInterval: 10_000,
  maxBuffer: 1_000,
  sampleRate: 1,
  captureFetch: true,
  captureXhr: true,
  captureErrors: true,
  captureConsoleErrors: false,
  heartbeat: true,
  captureNavigation: true,
  stripQuery: true,
  ignoreUrls: [],
  debug: false,
};

/** Global a host page can define before loading the script to override query params. */
export const GLOBAL_CONFIG_KEY = '__METRICS_CONFIG__';

const toNumber = (value: string | null): number | undefined => {
  if (value === null || value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
};
const toBoolean = (value: string | null): boolean | undefined => {
  if (value === null) {
    return undefined;
  }

  return value === '' || value === '1' || value === 'true';
};
const definedOnly = <T extends object>(input: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

/**
 * Reads configuration from the script's own URL, e.g.
 * `collector.js?endpoint=/__metrics/ingest&app=shell&env=qa&console=1`.
 */
export const parseQueryConfig = (scriptUrl: string): Partial<CollectorConfig> => {
  let params: URLSearchParams;

  try {
    params = new URL(scriptUrl).searchParams;
  } catch {
    return {};
  }

  const ignore = params.get('ignore');

  return definedOnly({
    endpoint: params.get('endpoint') ?? undefined,
    app: params.get('app') ?? undefined,
    env: params.get('env') ?? undefined,
    batchSize: toNumber(params.get('batchSize')),
    flushInterval: toNumber(params.get('flushInterval')),
    maxBuffer: toNumber(params.get('maxBuffer')),
    sampleRate: toNumber(params.get('sampleRate')),
    captureFetch: toBoolean(params.get('fetch')),
    captureXhr: toBoolean(params.get('xhr')),
    captureErrors: toBoolean(params.get('errors')),
    captureConsoleErrors: toBoolean(params.get('console')),
    heartbeat: toBoolean(params.get('heartbeat')),
    captureNavigation: toBoolean(params.get('navigation')),
    stripQuery: toBoolean(params.get('stripQuery')),
    ignoreUrls: ignore ? ignore.split(',').filter(Boolean) : undefined,
    debug: toBoolean(params.get('debug')),
  });
};

const resolveEndpoint = (endpoint: string, baseUrl: string | undefined): string => {
  if (!endpoint) {
    return '';
  }

  try {
    return new URL(endpoint, baseUrl ?? globalThis.location?.href).href;
  } catch {
    return endpoint;
  }
};
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Precedence: defaults < script URL query < `window.__METRICS_CONFIG__` < explicit overrides. */
export const resolveConfig = (
  scriptUrl?: string,
  overrides: Partial<CollectorConfig> = {},
): CollectorConfig => {
  const fromGlobal = (globalThis as Record<string, unknown>)[GLOBAL_CONFIG_KEY] as
    | Partial<CollectorConfig>
    | undefined;
  const merged: CollectorConfig = {
    ...DEFAULT_CONFIG,
    ...(scriptUrl ? parseQueryConfig(scriptUrl) : {}),
    ...fromGlobal,
    ...definedOnly(overrides),
  };

  return {
    ...merged,
    endpoint: resolveEndpoint(merged.endpoint, scriptUrl),
    batchSize: clamp(Math.floor(merged.batchSize), 1, 500),
    flushInterval: clamp(merged.flushInterval, 1_000, 300_000),
    maxBuffer: clamp(Math.floor(merged.maxBuffer), merged.batchSize, 10_000),
    sampleRate: clamp(merged.sampleRate, 0, 1),
  };
};
