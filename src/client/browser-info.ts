import type { BrowserInfo } from '../shared/types.js';

interface NavigatorExtras {
  userAgentData?: {
    brands?: { brand: string; version: string }[];
    platform?: string;
    mobile?: boolean;
  };
  deviceMemory?: number;
  connection?: { effectiveType?: string };
}

/** Collected once per page load and attached to every batch so the backend can group by it. */
export const collectBrowserInfo = (win: Window = window): BrowserInfo => {
  const nav = win.navigator as Navigator & NavigatorExtras;
  const uaData = nav.userAgentData;
  const brands = uaData?.brands
    ?.filter(({ brand }) => !brand.includes('Not'))
    .map(({ brand, version }) => `${brand} ${version}`);

  let timezone = '';

  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Intl unavailable: leave empty.
  }

  return {
    userAgent: nav.userAgent,
    brands: brands?.length ? brands : undefined,
    platform: uaData?.platform ?? undefined,
    mobile: uaData?.mobile,
    language: nav.language,
    timezone,
    screen: `${win.screen.width}x${win.screen.height}`,
    viewport: `${win.innerWidth}x${win.innerHeight}`,
    pixelRatio: win.devicePixelRatio,
    cores: nav.hardwareConcurrency || undefined,
    memoryGb: nav.deviceMemory,
    connection: nav.connection?.effectiveType,
  };
};
