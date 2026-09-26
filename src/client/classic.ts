/**
 * Classic (non-module) entry: `<script src="…/collector.classic.js?endpoint=…">`.
 * Classic scripts run synchronously while the HTML is parsed, so placed first in `<head>`
 * they instrument fetch before any other script runs. Module scripts are always deferred.
 */
import { autoInit } from './bootstrap.js';

const script = document.currentScript as HTMLScriptElement | null;

autoInit(script?.src);
