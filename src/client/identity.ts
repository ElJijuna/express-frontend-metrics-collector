export const createId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const CLIENT_KEY = '__metrics_client_id';
const TAB_KEY = '__metrics_tab_id';

/**
 * - `clientId`: browser profile, shared by every tab of the origin (`localStorage`).
 * - `tabId`: one tab, survives reloads (`sessionStorage`). "Duplicate tab" copies it,
 *   so {@link Presence} renews it when the original tab is still alive.
 * - `loadId`: one page load.
 */
export interface Identity {
  clientId: string;
  tabId: string;
  loadId: string;
}

type StorageName = 'localStorage' | 'sessionStorage';

/** Storage access throws with blocked cookies or sandboxed iframes: fall back to a fresh id. */
const readOrCreate = (win: Window, storage: StorageName, key: string): string => {
  try {
    const existing = win[storage].getItem(key);

    if (existing) {
      return existing;
    }

    const id = createId();

    win[storage].setItem(key, id);

    return id;
  } catch {
    return createId();
  }
};

export const readIdentity = (win: Window): Identity => ({
  clientId: readOrCreate(win, 'localStorage', CLIENT_KEY),
  tabId: readOrCreate(win, 'sessionStorage', TAB_KEY),
  loadId: createId(),
});

export const renewTabId = (win: Window): string => {
  const id = createId();

  try {
    win.sessionStorage.setItem(TAB_KEY, id);
  } catch {
    // Storage unavailable: the id lives only for this page load.
  }

  return id;
};
