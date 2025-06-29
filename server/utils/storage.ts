// Unified storage architecture - intelligent environment detection and adaptive storage system
import type { SecondaryStorage } from "better-auth";
import { createStorage, type Driver } from "unstorage";
import overlay from "unstorage/drivers/overlay";
import memory from "unstorage/drivers/memory";
import redisDriver from "unstorage/drivers/redis";
import fsDriver from "unstorage/drivers/fs";
import s3Driver from "unstorage/drivers/s3";
import Database from "better-sqlite3";
import { Pool } from "pg";
import { createPool } from "mysql2";
import { LibsqlDialect } from "@libsql/kysely-libsql";

/**
 * Simple database detection
 */
function detectDatabase() {
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
    return "turso";
  if (process.env.DATABASE_URL?.startsWith("postgres")) return "postgres";
  if (process.env.DATABASE_URL?.startsWith("mysql")) return "mysql";
  if (process.env.DATABASE_URL?.startsWith("mariadb")) return "mysql";
  return "sqlite";
}

function createRedisDriver() {
  if (!process.env.REDIS_URL) return null;
  try {
    const url = new URL(process.env.REDIS_URL);
    return redisDriver({
      base: "lens",
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      ...(url.protocol === "rediss:" && { tls: { rejectUnauthorized: false } }),
    });
  } catch {
    return null;
  }
}

function createMinIODriver() {
  if (
    process.env.MINIO_ENDPOINT &&
    process.env.MINIO_ACCESS_KEY &&
    process.env.MINIO_SECRET_KEY
  ) {
    return s3Driver({
      endpoint: process.env.MINIO_ENDPOINT,
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
      bucket: process.env.MINIO_BUCKET || "lens-cache",
      region: process.env.MINIO_REGION || "us-east-1",
    });
  }
  if (
    process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  ) {
    return s3Driver({
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      bucket: process.env.S3_BUCKET || "lens-cache",
      region: process.env.S3_REGION || "us-east-1",
    });
  }
  return null;
}

/**
 * Create cache storage
 */
function createCacheStorage() {
  const layers: Driver[] = [memory()];

  // Add Redis if available
  if (process.env.REDIS_URL) {
    const redis = createRedisDriver();
    if (redis) layers.push(redis);
  }

  // Add MinIO/S3 if available
  const minio = createMinIODriver();
  if (minio) layers.push(minio);

  // Filesystem fallback
  layers.push(fsDriver({ base: "./.cache" }));

  return createStorage({ driver: overlay({ layers }) });
}

/**
 * Get database for better-auth
 */
function getDatabase() {
  const dbType = detectDatabase();

  switch (dbType) {
    case "turso":
      return {
        dialect: new LibsqlDialect({
          url: process.env.TURSO_DATABASE_URL || "",
          authToken: process.env.TURSO_AUTH_TOKEN || "",
        }),
        type: "sqlite" as const,
      };

    case "postgres":
      return new Pool({ connectionString: process.env.DATABASE_URL });

    case "mysql":
      return createPool(process.env.DATABASE_URL);

    default:
      return new Database(".database.sqlite");
  }
}

/**
 * Global storage instance
 */
export const storage = createCacheStorage();

/**
 * SecondaryStorage adapter for better-auth
 */
export function createSecondaryStorageAdapter(): SecondaryStorage {
  return {
    async get(key: string): Promise<string | null> {
      try {
        // Use getItemRaw to ensure we get the raw string data
        // better-auth expects JSON string, not parsed object
        const value = await storage.getItemRaw(`auth:${key}`);
        if (value === null || value === undefined) {
          return null;
        }
        // Ensure we return a string
        if (Buffer.isBuffer(value)) {
          return value.toString("utf-8");
        }
        if (typeof value === "string") {
          return value;
        }
        // If it's an object, stringify it
        return JSON.stringify(value);
      } catch {
        return null;
      }
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      try {
        // Use setItemRaw to store the raw string data
        // This prevents unstorage from auto-parsing/serializing
        if (ttl) {
          await storage.setItemRaw(`auth:${key}`, value, { ttl });
        } else {
          await storage.setItemRaw(`auth:${key}`, value);
        }
      } catch {
        // Silent failure - graceful degradation
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await storage.removeItem(`auth:${key}`);
      } catch {
        // Silent failure - graceful degradation
      }
    },
  };
}

/**
 * Database instance for better-auth
 */
export const database = getDatabase();

/**
 * Optimized storage tool functions with prefix caching
 * Simple, explicit cache access without unnecessary abstractions
 */

// Create optimized storage accessor with cached prefix
function createStorageAccessor(prefix: string) {
  return {
    async get(key: string) {
      return await storage.getItemRaw(prefix + key);
    },
    async set(key: string, value: Buffer, ttl = 86400) {
      // Improved default cache time
      await storage.setItemRaw(prefix + key, value, { ttl });
    },
    async remove(key: string) {
      await storage.removeItem(prefix + key);
    },
    async has(key: string) {
      return await storage.hasItem(prefix + key);
    },
    // Optimized batch operations
    async getMultiple(keys: string[]) {
      // Pre-build all keys at once for better performance
      const prefixedKeys = keys.map((key) => prefix + key);
      const promises = prefixedKeys.map((fullKey) =>
        storage.getItemRaw(fullKey),
      );
      return await Promise.allSettled(promises);
    },
    async setMultiple(
      items: Array<{ key: string; value: Buffer; ttl?: number }>,
    ) {
      // Pre-build operations for better performance
      const promises = items.map(({ key, value, ttl }) =>
        storage.setItemRaw(prefix + key, value, { ttl }),
      );
      await Promise.allSettled(promises);
    },
  };
}

export const cacheStorage = {
  screenshots: {
    ...createStorageAccessor("screenshot:"),
    async set(key: string, value: Buffer, ttl = 86400) {
      // 24 hours default
      await storage.setItemRaw("screenshot:" + key, value, { ttl });
    },
  },
  ogImages: {
    ...createStorageAccessor("og:"),
    async set(key: string, value: Buffer, ttl = 86400) {
      // 24 hours default
      await storage.setItemRaw("og:" + key, value, { ttl });
    },
  },
  fonts: {
    ...createStorageAccessor("font:"),
    async set(key: string, value: Buffer, ttl = 86400 * 30) {
      await storage.setItemRaw("font:" + key, value, { ttl });
    },
  },
  favicons: {
    ...createStorageAccessor("favicon:"),
    async set(key: string, value: Buffer, ttl = 86400 * 7) {
      await storage.setItemRaw("favicon:" + key, value, { ttl });
    },
  },

  metadata: {
    async get<T = any>(key: string) {
      return await storage.getItem<T>(`meta:${key}`);
    },
    async set(key: string, value: any, ttl = 86400) {
      await storage.setItem(`meta:${key}`, value, { ttl });
    },
    async remove(key: string) {
      await storage.removeItem(`meta:${key}`);
    },
    async has(key: string) {
      return await storage.hasItem(`meta:${key}`);
    },
  },
};

/**
 * Backward-compatible cache access function
 * @deprecated Use specialized tool functions of cacheStorage
 */
export function useCache() {
  return storage;
}

/**
 * Simple storage health check
 */
export async function isStorageHealthy(): Promise<boolean> {
  try {
    const testKey = "__health_check__";
    const testValue = Date.now().toString();
    await storage.setItem(testKey, testValue);
    const retrieved = await storage.getItem(testKey);
    await storage.removeItem(testKey);
    return retrieved === testValue;
  } catch {
    return false;
  }
}

/**
 * Clear storage cache
 * Clears cache data of specified type
 */
export async function clearCacheByType(
  type: "screenshots" | "ogImages" | "fonts" | "favicons" | "metadata" | "all",
): Promise<void> {
  if (type === "all") {
    const keys = await storage.getKeys();
    await Promise.all(keys.map((key) => storage.removeItem(key)));
    return;
  }

  const prefix = type === "ogImages" ? "og:" : `${type}:`;
  const keys = await storage.getKeys();
  const targetKeys = keys.filter((key) => key.startsWith(prefix));
  await Promise.all(targetKeys.map((key) => storage.removeItem(key)));
}
