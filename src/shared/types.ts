/**
 * Wire format shared by the browser collector and the Express ingest endpoint.
 * Bump {@link PROTOCOL_VERSION} on any breaking change.
 */
export const PROTOCOL_VERSION = 2;

/**
 * Compact request record: `[METHOD, URL, status, startEpochMs, endEpochMs]`.
 * A tuple instead of an object keeps memory and payload size ~40% smaller.
 * `status` is `0` when the request failed at network level or was aborted.
 */
export type RequestRecord = [
  method: string,
  url: string,
  status: number,
  start: number,
  end: number,
];

/** SPA route change: `[url, epochMs]`. The first one of a page load is the initial URL. */
export type NavigationRecord = [url: string, at: number];

export type ErrorKind = 'error' | 'rejection' | 'resource' | 'console';

export interface ErrorRecord {
  kind: ErrorKind;
  message: string;
  stack?: string;
  /** Script / asset URL where the error originated. Useful to attribute it to a microfrontend. */
  source?: string;
  line?: number;
  column?: number;
  /** Page URL when the error first happened. */
  page: string;
  /** Epoch ms of the first occurrence inside this batch. */
  firstSeen: number;
  /** Epoch ms of the last occurrence inside this batch. */
  lastSeen: number;
  /** Identical errors inside the same batch are collapsed into one record. */
  count: number;
}

export interface BrowserInfo {
  userAgent: string;
  /** From User-Agent Client Hints when available (Chromium). */
  brands?: string[];
  platform?: string;
  mobile?: boolean;
  language: string;
  timezone: string;
  screen: string;
  viewport: string;
  pixelRatio: number;
  cores?: number;
  memoryGb?: number;
  connection?: string;
}

export interface MetricsBatch {
  v: typeof PROTOCOL_VERSION;
  app: string;
  env?: string;
  /** Browser profile (`localStorage`), shared by all its tabs of this origin. */
  clientId: string;
  /** Tab (`sessionStorage`); survives reloads and is unique even for duplicated tabs. */
  tabId: string;
  /** Page load; `seq` restarts with each one. */
  loadId: string;
  /** Monotonic batch counter within the page load; gaps mean lost batches. */
  seq: number;
  page: string;
  /** `document.visibilityState === 'visible'` when the batch was built. */
  visible: boolean;
  sentAt: number;
  browser: BrowserInfo;
  requests: RequestRecord[];
  errors: ErrorRecord[];
  navigations: NavigationRecord[];
  /**
   * Open tab ids of this client. Only sent by the leader tab, one per client, so the
   * backend can treat any tab missing from the list as closed.
   */
  tabs?: string[];
  /** Last batch of this page load (tab closed, reloaded or navigated away). */
  final?: true;
  /** Records discarded because buffers were full since the previous batch. */
  dropped: { requests: number; errors: number };
}
