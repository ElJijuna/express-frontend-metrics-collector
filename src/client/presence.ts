import { type Identity, readIdentity, renewTabId } from './identity.js';

const TAB_LOCK_PREFIX = 'metrics-collector:tab:';
const LEADER_LOCK = 'metrics-collector:leader';

/**
 * Tab presence through the Web Locks API (same-origin, shared by all tabs):
 *
 * - Every tab holds `metrics-collector:tab:<tabId>`. The browser releases it when the tab
 *   closes or crashes, so `locks.query()` lists exactly the open tabs of this client.
 * - If that lock is already held, this tab is a "Duplicate tab" copy and gets a new `tabId`.
 * - One tab holds the leader lock; the next one takes over automatically when it closes.
 *   Only the leader heartbeats and reports the tab list, so N tabs cost one heartbeat.
 *
 * Without Web Locks (Safari < 15.4) every tab heartbeats on its own.
 */
export class Presence {
  readonly identity: Identity;
  private leader = false;
  private openTabs: string[] | undefined;
  private readonly releasers: (() => void)[] = [];
  private readonly abort = new AbortController();
  private readonly locks: LockManager | undefined;

  /** `locks: null` forces the fallback without Web Locks. */
  constructor(
    private readonly win: Window,
    locks: LockManager | null = (win.navigator as Partial<Navigator>).locks ?? null,
  ) {
    this.identity = readIdentity(win);
    this.locks = locks ?? undefined;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  /** Open tabs of this client, only known by the leader. */
  get tabs(): string[] | undefined {
    return this.openTabs;
  }

  get shouldHeartbeat(): boolean {
    return this.locks === undefined || this.leader;
  }

  /** Resolves once the tab id is settled; leadership is acquired in the background. Never rejects. */
  async start(): Promise<void> {
    if (!this.locks) {
      return;
    }

    if (!(await this.hold(TAB_LOCK_PREFIX + this.identity.tabId))) {
      this.identity.tabId = renewTabId(this.win);
      await this.hold(TAB_LOCK_PREFIX + this.identity.tabId);
    }

    void this.acquireLeadership();
  }

  /** Refreshes the tab list; call it right before building a heartbeat. */
  async refresh(): Promise<void> {
    if (!this.locks || !this.leader) {
      this.openTabs = undefined;

      return;
    }

    try {
      const { held = [] } = await this.locks.query();
      const tabs = held
        .map(({ name }) => name ?? '')
        .filter((name) => name.startsWith(TAB_LOCK_PREFIX))
        .map((name) => name.slice(TAB_LOCK_PREFIX.length));

      this.openTabs = [...new Set(tabs)];
    } catch {
      this.openTabs = undefined;
    }
  }

  stop(): void {
    this.abort.abort();
    this.leader = false;

    for (const release of this.releasers.splice(0)) {
      release();
    }
  }

  /** Waits (possibly forever) until the current leader tab closes. */
  private async acquireLeadership(): Promise<void> {
    this.leader = await this.hold(LEADER_LOCK, { signal: this.abort.signal });
  }

  /**
   * Requests a lock and keeps it until {@link stop}. Resolves `true` once granted,
   * `false` when unavailable (tab locks use `ifAvailable`) or aborted.
   */
  private hold(name: string, options: LockOptions = { ifAvailable: true }): Promise<boolean> {
    const { locks } = this;

    if (!locks) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const request = async (): Promise<void> => {
        try {
          await locks.request(name, options, (lock) => {
            if (!lock || this.abort.signal.aborted) {
              resolve(false);

              return undefined;
            }

            resolve(true);

            return new Promise<void>((release) => this.releasers.push(release));
          });
        } catch {
          // Aborted while waiting, or Web Locks unavailable in this context (e.g. opaque origin).
          resolve(false);
        }
      };

      void request();
    });
  }
}
