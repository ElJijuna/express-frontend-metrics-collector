import { Collector } from './collector.js';
import { type CollectorConfig, resolveConfig } from './config.js';

const INSTANCE_KEY = '__METRICS_COLLECTOR__';

type GlobalWithCollector = typeof globalThis & { [INSTANCE_KEY]?: Collector | null };

/**
 * Starts the collector once per page. Several microfrontends may include the script;
 * only the first one wins and the rest get the same instance.
 * Returns `null` when the page load was sampled out or no endpoint is configured.
 */
export const init = (
  scriptUrl?: string,
  overrides: Partial<CollectorConfig> = {},
): Collector | null => {
  const scope = globalThis as GlobalWithCollector;

  if (typeof window === 'undefined') {
    return null;
  }

  if (scope[INSTANCE_KEY] !== undefined) {
    return scope[INSTANCE_KEY];
  }

  const config = resolveConfig(scriptUrl, overrides);

  if (!config.endpoint || Math.random() >= config.sampleRate) {
    scope[INSTANCE_KEY] = null;

    return null;
  }

  const collector = new Collector(config).start();

  scope[INSTANCE_KEY] = collector;

  return collector;
};

/** Auto-start only when the script URL (or the global config) provides an endpoint. */
export const autoInit = (scriptUrl: string | undefined): Collector | null => {
  if (scriptUrl && new URL(scriptUrl).searchParams.get('auto') === '0') {
    return null;
  }

  return resolveConfig(scriptUrl).endpoint ? init(scriptUrl) : null;
};
