import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/services/storage.ts';

// The checked IndexedDB operations behind the user's routes and the creator's
// draft: they reject instead of failing silently, and update() is atomic.

const KEY = 'test:counter';

afterEach(async () => {
  vi.restoreAllMocks();
  await db.del(KEY);
});

describe('db.update', () => {
  it('reads and writes in one transaction: concurrent updates all count', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => db.update<number>(KEY, (old) => (old ?? 0) + 1)),
    );
    expect(await db.get(KEY)).toBe(20);
  });

  it('deletes the key when the updater returns undefined, and writes nothing when unchanged', async () => {
    const value = { n: 1 };
    await db.set(KEY, value);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    await db.update<{ n: number }>(KEY, (old) => old);
    expect(put).not.toHaveBeenCalled();
    await db.update(KEY, () => undefined);
    expect(await db.get(KEY)).toBeUndefined();
  });

  it('rejects and writes nothing when the updater throws', async () => {
    await db.set(KEY, 1);
    await expect(
      db.update<number>(KEY, () => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await db.get(KEY)).toBe(1);
  });

  it('rejects when the read fails, and the value is still there', async () => {
    await db.set(KEY, 1);
    const read = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('Disk I/O error', 'UnknownError');
    });
    const updater = vi.fn(() => 2);
    await expect(db.update(KEY, updater)).rejects.toThrow('Disk I/O error');
    expect(updater).not.toHaveBeenCalled();
    read.mockRestore();
    expect(await db.get(KEY)).toBe(1);
  });

  it('rejects when the value cannot be stored (e.g. a function inside)', async () => {
    await expect(db.update(KEY, () => ({ run: () => 1 }))).rejects.toThrow();
    expect(await db.get(KEY)).toBeUndefined();
  });
});

describe('the checked get and set', () => {
  it('reject where the soft ones resolve', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('Disk I/O error', 'UnknownError');
    });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await expect(db.getChecked(KEY)).rejects.toThrow('Disk I/O error');
    await expect(db.setChecked(KEY, 1)).rejects.toThrow('Quota exceeded');
    expect(await db.get(KEY)).toBeUndefined();
    await expect(db.set(KEY, 1)).resolves.toBeUndefined();
  });
});
