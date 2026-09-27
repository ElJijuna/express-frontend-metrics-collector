/**
 * ES module entry: `<script type="module" src="…/collector.js?endpoint=…&app=…">`.
 * Can also be imported from a bundler and started manually with `init()`.
 */
import { autoInit } from './bootstrap.js';

export type {
  BrowserInfo,
  ErrorRecord,
  MetricsBatch,
  NavigationRecord,
  RequestRecord,
} from '../shared/types.js';
export { init } from './bootstrap.js';
export { Collector } from './collector.js';
export { type CollectorConfig, DEFAULT_CONFIG, resolveConfig } from './config.js';

autoInit(import.meta.url);
