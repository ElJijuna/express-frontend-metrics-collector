/**
 * Epoch milliseconds derived from the monotonic clock, so start/end pairs are never
 * skewed by wall-clock adjustments during the page's lifetime.
 */
export const now = (): number => Math.round(performance.timeOrigin + performance.now());
