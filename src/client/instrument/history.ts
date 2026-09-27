export type NavigationListener = (url: string) => void;

type HistoryMethod = History['pushState'];

/**
 * Reports SPA route changes (`pushState`, `replaceState`, back/forward, hash changes).
 * Returns a function that restores the original methods.
 */
export const instrumentHistory = (win: Window, onNavigate: NavigationListener): (() => void) => {
  const { history } = win;
  const notify = (): void => onNavigate(win.location.href);
  const wrap = (original: HistoryMethod): HistoryMethod =>
    function (this: History, ...args: Parameters<HistoryMethod>) {
      original.apply(this, args);
      notify();
    };
  // Kept unbound on purpose: they are re-invoked with `history` as `this` and restored on teardown.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalPush = history.pushState;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalReplace = history.replaceState;
  const push = wrap(originalPush);
  const replace = wrap(originalReplace);

  history.pushState = push;
  history.replaceState = replace;
  win.addEventListener('popstate', notify);
  win.addEventListener('hashchange', notify);

  return () => {
    if (history.pushState === push) {
      history.pushState = originalPush;
    }

    if (history.replaceState === replace) {
      history.replaceState = originalReplace;
    }

    win.removeEventListener('popstate', notify);
    win.removeEventListener('hashchange', notify);
  };
};
