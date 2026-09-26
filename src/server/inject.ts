import type { NextFunction, Request, Response } from 'express';

export const INJECT_MARKER = 'data-metrics-collector';

/**
 * Inserts `tag` at the top of `<head>` (after `<meta charset>` when present, which must stay
 * first) so it runs before the app's own scripts. Falls back to before `<body>`. Returns the
 * input untouched when it is not an HTML document or the tag is already present.
 */
export const injectTag = (html: string, tag: string): string => {
  if (html.includes(INJECT_MARKER)) {
    return html;
  }

  const anchor = /<meta\s+charset=[^>]*>/i.exec(html) ?? /<head(\s[^>]*)?>/i.exec(html);

  if (anchor) {
    const at = anchor.index + anchor[0].length;

    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }

  const body = /<body[\s>]/i.exec(html);

  if (body) {
    return `${html.slice(0, body.index)}${tag}${html.slice(body.index)}`;
  }

  return html;
};

type WriteCallback = (error?: Error | null) => void;

const toBuffer = (chunk: unknown, encoding?: unknown): Buffer => {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  return Buffer.from(
    String(chunk),
    typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
  );
};

/**
 * Express middleware that rewrites HTML responses on the fly. It patches `res.write`/`res.end`
 * rather than `res.send`, so it also covers `express.static`, `res.sendFile` and SSR renderers.
 * Must be registered *after* `compression()` so it sees the uncompressed body.
 */
export const createHtmlInjector =
  (getTag: (req: Request) => string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' || !req.accepts('html')) {
      next();

      return;
    }

    const originalWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
    const originalEnd = res.end.bind(res) as (...args: unknown[]) => Response;
    const chunks: Buffer[] = [];

    let mode: 'pending' | 'buffer' | 'pass' = 'pending';

    const decide = (): void => {
      if (mode !== 'pending') {
        return;
      }

      const contentType = String(res.getHeader('content-type') ?? '');
      const encoding = String(res.getHeader('content-encoding') ?? 'identity');
      const hasBody = res.statusCode !== 204 && res.statusCode !== 304;

      mode =
        !res.headersSent && hasBody && contentType.includes('text/html') && encoding === 'identity'
          ? 'buffer'
          : 'pass';
    };

    res.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      decide();

      if (mode === 'pass') {
        return originalWrite(chunk, encoding, callback);
      }

      chunks.push(toBuffer(chunk, encoding));
      const done = typeof encoding === 'function' ? encoding : callback;

      if (typeof done === 'function') {
        (done as WriteCallback)();
      }

      return true;
    }) as Response['write'];

    res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
      decide();

      if (mode === 'pass') {
        return originalEnd(chunk, encoding, callback);
      }

      if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
        chunks.push(toBuffer(chunk, encoding));
      }

      const done = [chunk, encoding, callback].find((arg) => typeof arg === 'function');
      const html = injectTag(Buffer.concat(chunks).toString('utf8'), getTag(req));

      res.setHeader('Content-Length', Buffer.byteLength(html));
      // The body changed, so a validator computed from the original file would lie.
      res.removeHeader('ETag');

      return originalEnd(html, 'utf8', done);
    }) as Response['end'];

    next();
  };
