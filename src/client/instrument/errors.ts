import type { ErrorRecord } from '../../shared/types.js';

export type CapturedError = Omit<ErrorRecord, 'count' | 'firstSeen' | 'lastSeen' | 'page'>;
export type ErrorListener = (error: CapturedError) => void;

const MAX_MESSAGE = 1_000;
const MAX_STACK = 4_000;
const truncate = (value: string | undefined, max: number): string | undefined =>
  value && value.length > max ? `${value.slice(0, max)}…` : value;
const describeReason = (reason: unknown): { message: string; stack?: string } => {
  if (reason instanceof Error) {
    return { message: `${reason.name}: ${reason.message}`, stack: reason.stack };
  }

  if (typeof reason === 'string') {
    return { message: reason };
  }

  try {
    return { message: JSON.stringify(reason) ?? String(reason) };
  } catch {
    return { message: String(reason) };
  }
};
const assetUrl = (element: Element): string | undefined => {
  if ('src' in element && typeof element.src === 'string' && element.src) {
    return element.src;
  }

  if ('href' in element && typeof element.href === 'string' && element.href) {
    return element.href;
  }

  return undefined;
};

/**
 * Captures uncaught errors, unhandled promise rejections and failed asset loads
 * (`<script>`, `<link>`, `<img>`), the latter being the usual symptom of a remote
 * microfrontend that is down. Listens in the capture phase because resource errors
 * do not bubble.
 */
export const instrumentErrors = (
  win: Window & typeof globalThis,
  onError: ErrorListener,
  captureConsole: boolean,
): (() => void) => {
  const emit = (error: CapturedError): void => {
    onError({
      ...error,
      message: truncate(error.message, MAX_MESSAGE) ?? '',
      stack: truncate(error.stack, MAX_STACK),
    });
  };
  const handleError = (event: Event): void => {
    const { target } = event;

    if (target && target !== win && target instanceof win.Element) {
      emit({
        kind: 'resource',
        message: `Failed to load <${target.tagName.toLowerCase()}>`,
        source: assetUrl(target),
      });

      return;
    }

    const errorEvent = event as ErrorEvent;
    const described = errorEvent.error
      ? describeReason(errorEvent.error)
      : { message: errorEvent.message };

    emit({
      kind: 'error',
      message: described.message || errorEvent.message || 'Unknown error',
      stack: described.stack,
      source: errorEvent.filename || undefined,
      line: errorEvent.lineno || undefined,
      column: errorEvent.colno || undefined,
    });
  };
  const handleRejection = (event: PromiseRejectionEvent): void => {
    emit({ kind: 'rejection', ...describeReason(event.reason) });
  };

  win.addEventListener('error', handleError, true);
  win.addEventListener('unhandledrejection', handleRejection);

  const originalConsoleError = win.console.error;

  if (captureConsole) {
    win.console.error = (...args: unknown[]): void => {
      const error = args.find((arg): arg is Error => arg instanceof Error);
      const described = error
        ? describeReason(error)
        : { message: args.map((arg) => describeReason(arg).message).join(' ') };

      emit({ kind: 'console', ...described });
      originalConsoleError.apply(win.console, args);
    };
  }

  return () => {
    win.removeEventListener('error', handleError, true);
    win.removeEventListener('unhandledrejection', handleRejection);

    if (captureConsole) {
      win.console.error = originalConsoleError;
    }
  };
};
