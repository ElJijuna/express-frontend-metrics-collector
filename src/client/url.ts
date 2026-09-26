import type { UrlMatcher } from './config.js';

/** Normalises a request URL to an absolute one, optionally without query string and hash. */
export const normalizeUrl = (
  raw: string,
  stripQuery: boolean,
  base = globalThis.location?.href,
): string => {
  try {
    const url = new URL(raw, base);

    if (stripQuery) {
      url.search = '';
      url.hash = '';
    }

    return url.href;
  } catch {
    return raw;
  }
};

export const matchesAny = (url: string, matchers: UrlMatcher[]): boolean =>
  matchers.some((matcher) =>
    typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url),
  );
