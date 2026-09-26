import type { ErrorRecord } from '../shared/types.js';

/**
 * Fixed-capacity FIFO backed by a preallocated array. Pushing into a full buffer
 * overwrites the oldest item, so memory stays bounded no matter how chatty the app is.
 */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0;
  private length = 0;
  private droppedCount = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.length;
  }

  push(item: T): void {
    const tail = (this.head + this.length) % this.capacity;

    this.items[tail] = item;

    if (this.length < this.capacity) {
      this.length += 1;
    } else {
      this.head = (this.head + 1) % this.capacity;
      this.droppedCount += 1;
    }
  }

  /** Removes and returns up to `max` of the oldest items. */
  drain(max = this.length): T[] {
    const count = Math.min(max, this.length);
    const out = new Array<T>(count);

    for (let index = 0; index < count; index += 1) {
      const slot = (this.head + index) % this.capacity;

      out[index] = this.items[slot] as T;
      this.items[slot] = undefined;
    }

    this.head = (this.head + count) % this.capacity;
    this.length -= count;

    return out;
  }

  /** Returns the number of items dropped since the last call and resets the counter. */
  takeDropped(): number {
    const dropped = this.droppedCount;

    this.droppedCount = 0;

    return dropped;
  }
}

export const errorFingerprint = (
  error: Pick<ErrorRecord, 'kind' | 'message' | 'source' | 'line' | 'column'>,
): string =>
  `${error.kind}|${error.message}|${error.source ?? ''}|${error.line ?? ''}|${error.column ?? ''}`;

/**
 * Collapses repeated errors (e.g. an error thrown inside a render loop) into a single
 * record with a counter, preserving insertion order.
 */
export class ErrorBuffer {
  private readonly records = new Map<string, ErrorRecord>();
  private droppedCount = 0;

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.records.size;
  }

  push(error: Omit<ErrorRecord, 'count' | 'firstSeen' | 'lastSeen'>, timestamp: number): void {
    const key = errorFingerprint(error);
    const existing = this.records.get(key);

    if (existing) {
      existing.count += 1;
      existing.lastSeen = timestamp;

      return;
    }

    if (this.records.size >= this.capacity) {
      this.droppedCount += 1;

      return;
    }

    this.records.set(key, { ...error, count: 1, firstSeen: timestamp, lastSeen: timestamp });
  }

  /** Puts back a record from a failed batch, merging it with newer occurrences. */
  restore(record: ErrorRecord): void {
    const key = errorFingerprint(record);
    const existing = this.records.get(key);

    if (existing) {
      existing.count += record.count;
      existing.firstSeen = Math.min(existing.firstSeen, record.firstSeen);

      return;
    }

    if (this.records.size >= this.capacity) {
      this.droppedCount += record.count;

      return;
    }

    this.records.set(key, record);
  }

  drain(max = this.records.size): ErrorRecord[] {
    const out: ErrorRecord[] = [];

    for (const [key, record] of this.records) {
      if (out.length >= max) {
        break;
      }

      out.push(record);
      this.records.delete(key);
    }

    return out;
  }

  takeDropped(): number {
    const dropped = this.droppedCount;

    this.droppedCount = 0;

    return dropped;
  }
}
