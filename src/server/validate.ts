import { type MetricsBatch, PROTOCOL_VERSION } from '../shared/types.js';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isRequestRecord = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 5 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'string' &&
  typeof value[2] === 'number' &&
  typeof value[3] === 'number' &&
  typeof value[4] === 'number';
const isNavigationRecord = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'number';
const isErrorRecord = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.kind === 'string' &&
  typeof value.message === 'string' &&
  typeof value.count === 'number';

/** Shallow structural check of an incoming batch; the endpoint is public, so never trust it blindly. */
export const isMetricsBatch = (value: unknown): value is MetricsBatch =>
  isObject(value) &&
  value.v === PROTOCOL_VERSION &&
  typeof value.app === 'string' &&
  typeof value.clientId === 'string' &&
  typeof value.tabId === 'string' &&
  typeof value.loadId === 'string' &&
  typeof value.seq === 'number' &&
  (value.tabs === undefined ||
    (Array.isArray(value.tabs) && value.tabs.every((tab) => typeof tab === 'string'))) &&
  isObject(value.browser) &&
  isObject(value.dropped) &&
  Array.isArray(value.requests) &&
  value.requests.every(isRequestRecord) &&
  Array.isArray(value.errors) &&
  value.errors.every(isErrorRecord) &&
  Array.isArray(value.navigations) &&
  value.navigations.every(isNavigationRecord);
