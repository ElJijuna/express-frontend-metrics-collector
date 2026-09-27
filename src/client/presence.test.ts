// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Presence } from './presence.js';

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Waiter {
  callback: LockGrantedCallback<unknown>;
  resolve: (value: unknown) => void;
}

/** Minimal in-memory Web Locks shared by several "tabs" of the same origin. */
class FakeLocks {
  private readonly held = new Set<string>();
  private readonly queues = new Map<string, Waiter[]>();

  request(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.held.has(name)) {
        this.grant(name, { callback, resolve });

        return;
      }

      if (options.ifAvailable) {
        resolve(callback(null));

        return;
      }

      const queue = this.queues.get(name) ?? [];

      queue.push({ callback, resolve });
      this.queues.set(name, queue);
      options.signal?.addEventListener('abort', () => {
        this.queues.set(
          name,
          (this.queues.get(name) ?? []).filter((waiter) => waiter.resolve !== resolve),
        );
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }

  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({
      held: [...this.held].map((name) => ({ name, mode: 'exclusive' as const })),
      pending: [],
    });
  }

  private grant(name: string, { callback, resolve }: Waiter): void {
    this.held.add(name);

    const run = async (): Promise<void> => {
      const value: unknown = await callback({ name, mode: 'exclusive' });

      this.held.delete(name);
      resolve(value);
      const next = this.queues.get(name)?.shift();

      if (next) {
        this.grant(name, next);
      }
    };

    void run();
  }
}

describe('Presence', () => {
  let locks: FakeLocks;

  const started: Presence[] = [];
  const openTab = async () => {
    const presence = new Presence(window, locks as unknown as LockManager);

    started.push(presence);
    await presence.start();
    await flushMicrotasks();

    return presence;
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    locks = new FakeLocks();
  });

  afterEach(() => {
    for (const presence of started.splice(0)) {
      presence.stop();
    }
  });

  it('keeps clientId across tabs and tabId across reloads of the same tab', () => {
    const first = new Presence(window, null).identity;
    const reload = new Presence(window, null).identity;

    expect(reload.clientId).toBe(first.clientId);
    expect(reload.tabId).toBe(first.tabId);
    expect(reload.loadId).not.toBe(first.loadId);
  });

  it('renews the tabId of a duplicated tab while the original is open', async () => {
    const original = await openTab();
    // "Duplicate tab" copies sessionStorage, which is what reusing the same window simulates.
    const duplicate = await openTab();

    expect(duplicate.identity.clientId).toBe(original.identity.clientId);
    expect(duplicate.identity.tabId).not.toBe(original.identity.tabId);
    expect(sessionStorage.getItem('__metrics_tab_id')).toBe(duplicate.identity.tabId);
  });

  it('elects one leader that reports the open tabs and hands over when it closes', async () => {
    const first = await openTab();
    const second = await openTab();

    expect(first.isLeader).toBe(true);
    expect(second.isLeader).toBe(false);
    expect(first.shouldHeartbeat).toBe(true);
    expect(second.shouldHeartbeat).toBe(false);

    await first.refresh();
    expect(first.tabs?.sort()).toEqual([first.identity.tabId, second.identity.tabId].sort());

    first.stop();
    await flushMicrotasks();

    expect(second.isLeader).toBe(true);
    await second.refresh();
    expect(second.tabs).toEqual([second.identity.tabId]);
  });

  it('makes every tab heartbeat when Web Locks are unavailable', async () => {
    const presence = new Presence(window, null);

    await presence.start();
    await presence.refresh();

    expect(presence.shouldHeartbeat).toBe(true);
    expect(presence.tabs).toBeUndefined();
  });
});
