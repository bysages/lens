import { useStorage } from "nitro/storage";

// ── Types ──────────────────────────────────────────────

export interface DatasetRecord {
  url: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface Dataset<T extends DatasetRecord = DatasetRecord> {
  /** Append one or more records */
  pushData(data: T | T[]): Promise<void>;
  /** Read all records */
  getData(): Promise<T[]>;
  /** Read the latest record */
  getLatest(): Promise<T | null>;
}

export interface DatasetOptions {
  /** Dataset name (used as storage prefix) */
  name: string;
  /** TTL in seconds (defaults to 86400 / 1 day) */
  ttl?: number;
}

// ── Implementation ─────────────────────────────────────

/**
 * Create a Dataset backed by unstorage (via nitro's useStorage).
 *
 * Records are stored with prefix `{name}:{index}` as JSON.
 * An index key `{name}:_meta` tracks the current count.
 */
export function createDataset<T extends DatasetRecord = DatasetRecord>(
  options: DatasetOptions,
): Dataset<T> {
  const { name, ttl = 86400 } = options;
  const prefix = `dataset:${name}`;
  const metaKey = `${prefix}:_meta`;

  function storage() {
    return useStorage("cache");
  }

  async function getCount(): Promise<number> {
    const meta = await storage().getItem<{ count: number }>(metaKey);
    return meta?.count ?? 0;
  }

  return {
    async pushData(data: T | T[]): Promise<void> {
      const items = Array.isArray(data) ? data : [data];
      let count = await getCount();

      for (const item of items) {
        await storage().setItem(`${prefix}:${count}`, item, { ttl });
        count++;
      }

      await storage().setItem(metaKey, { count }, { ttl });
    },

    async getData(): Promise<T[]> {
      const count = await getCount();
      if (count === 0) return [];

      const items: T[] = [];
      for (let i = 0; i < count; i++) {
        const item = await storage().getItem<T>(`${prefix}:${i}`);
        if (item) items.push(item);
      }

      return items;
    },

    async getLatest(): Promise<T | null> {
      const count = await getCount();
      if (count === 0) return null;

      return (await storage().getItem<T>(`${prefix}:${count - 1}`)) ?? null;
    },
  };
}
