import { describe, expect, it } from 'vitest';
import { ErrorBuffer, RingBuffer } from './buffer.js';

describe('RingBuffer', () => {
  it('drains items in FIFO order', () => {
    const buffer = new RingBuffer<number>(5);

    for (const n of [1, 2, 3]) {
      buffer.push(n);
    }

    expect(buffer.drain(2)).toEqual([1, 2]);
    expect(buffer.drain()).toEqual([3]);
    expect(buffer.size).toBe(0);
  });

  it('overwrites the oldest items when full and counts them as dropped', () => {
    const buffer = new RingBuffer<number>(3);

    for (const n of [1, 2, 3, 4, 5]) {
      buffer.push(n);
    }

    expect(buffer.drain()).toEqual([3, 4, 5]);
    expect(buffer.takeDropped()).toBe(2);
    expect(buffer.takeDropped()).toBe(0);
  });

  it('keeps working after wrapping around', () => {
    const buffer = new RingBuffer<number>(3);

    for (const n of [1, 2]) {
      buffer.push(n);
    }

    buffer.drain(1);

    for (const n of [3, 4]) {
      buffer.push(n);
    }

    expect(buffer.drain()).toEqual([2, 3, 4]);
  });
});

describe('ErrorBuffer', () => {
  const error = {
    kind: 'error' as const,
    message: 'boom',
    page: 'http://app/',
    source: 'http://mfe/a.js',
    line: 1,
  };

  it('collapses identical errors into one record with a count', () => {
    const buffer = new ErrorBuffer(10);

    buffer.push(error, 100);
    buffer.push(error, 200);
    buffer.push({ ...error, message: 'other' }, 300);

    const [first, second] = buffer.drain();

    expect(first).toMatchObject({ message: 'boom', count: 2, firstSeen: 100, lastSeen: 200 });
    expect(second).toMatchObject({ message: 'other', count: 1 });
  });

  it('drops new distinct errors beyond capacity', () => {
    const buffer = new ErrorBuffer(1);

    buffer.push(error, 1);
    buffer.push({ ...error, message: 'other' }, 2);

    expect(buffer.size).toBe(1);
    expect(buffer.takeDropped()).toBe(1);
  });

  it('restores a failed record merging it with newer occurrences', () => {
    const buffer = new ErrorBuffer(10);

    buffer.push(error, 100);
    const [record] = buffer.drain();

    buffer.push(error, 500);

    if (record) {
      buffer.restore(record);
    }

    expect(buffer.drain()).toEqual([
      expect.objectContaining({ count: 2, firstSeen: 100, lastSeen: 500 }),
    ]);
  });
});
