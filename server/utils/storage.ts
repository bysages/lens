// Unified storage architecture - intelligent environment detection and adaptive storage system
import type { SecondaryStorage } from "better-auth";
import { createStorage } from "unstorage";
import overlay from "unstorage/drivers/overlay";
import memory from "unstorage/drivers/memory";
import redisDriver from "unstorage/drivers/redis";
import fsDriver from "unstorage/drivers/fs";
import s3Driver from "unstorage/drivers/s3";
import Database from "better-sqlite3";

/**
 * Environment detection result type
 */
interface EnvironmentDetection {
  // Platform environment
  isDevelopment: boolean;

  // Cache storage availability
  hasRedis: boolean;
  hasMinIO: boolean;

  // Database availability
  hasTurso: boolean;
  hasPostgreSQL: boolean;
  hasMySQL: boolean;
  hasSQLServer: boolean;
}

/**
 * Database configuration type
 */
interface DatabaseConfig {
  type: "sqlite" | "postgres" | "mysql" | "mssql" | "turso";
  connection: any;
  dialect: string;
}

/**
 * Intelligent environment detection
 * Detects all available storage and database services
 */
function detectEnvironment(): EnvironmentDetection {
  // Platform environment detection
  const isDevelopment =
    process.env.NODE_ENV === "development" || !process.env.NODE_ENV;

  // Cache storage availability detection
  const hasRedis = !!process.env.REDIS_URL;
  const hasMinIO =
    !!(
      process.env.MINIO_ENDPOINT &&
      process.env.MINIO_ACCESS_KEY &&
      process.env.MINIO_SECRET_KEY
    ) ||
    !!(
      process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
    );

  // Database availability detection
  const hasTurso = !!(
    process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN
  );
  const hasPostgreSQL =
    !!process.env.DATABASE_URL &&
    process.env.DATABASE_URL.startsWith("postgres");
  const hasMySQL =
    !!process.env.DATABASE_URL &&
    (process.env.DATABASE_URL.startsWith("mysql") ||
      process.env.DATABASE_URL.startsWith("mariadb"));
  const hasSQLServer =
    !!process.env.DATABASE_URL &&
    process.env.DATABASE_URL.startsWith("sqlserver");

  return {
    isDevelopment,
    hasRedis,
    hasMinIO,
    hasTurso,
    hasPostgreSQL,
    hasMySQL,
    hasSQLServer,
  };
}

/**
 * Create Redis driver configuration
 */
function createRedisDriver() {
  if (!process.env.REDIS_URL) return null;

  try {
    const url = new URL(process.env.REDIS_URL);
    return redisDriver({
      base: "lens",
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      ...(url.protocol === "rediss:" && {
        tls: {
          rejectUnauthorized: false,
        },
      }),
    });
  } catch {
    return null;
  }
}

/**
 * Create MinIO/S3 driver configuration
 */
function createMinIODriver() {
  // Prefer MinIO configuration
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

  // Use S3 configuration
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
 * Create adaptive cache storage
 * Intelligently selects optimal storage driver combination based on environment variables
 */
function createAdaptiveCacheStorage() {
  const env = detectEnvironment();
  const layers: any[] = [];

  // Always add memory layer as fastest cache
  layers.push(memory());

  // Add persistence layers by priority
  if (env.hasRedis) {
    const redis = createRedisDriver();
    if (redis) {
      layers.push(redis);
    }
  }

  if (env.hasMinIO) {
    const minio = createMinIODriver();
    if (minio) {
      layers.push(minio);
    }
  }

  // Finally add filesystem as basic fallback
  layers.push(fsDriver({ base: "./.cache" }));

  return createStorage({
    driver: overlay({ layers }),
  });
}

/**
 * Create adaptive database configuration
 * Intelligently selects optimal database based on environment variables
 * Only supports databases with built-in Kysely adapter in better-auth
 */
function createAdaptiveDatabaseConfig(): DatabaseConfig {
  const env = detectEnvironment();

  // 1. Turso (distributed SQLite) - optimal choice
  if (env.hasTurso) {
    return {
      type: "turso",
      connection: {
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      },
      dialect: "turso",
    };
  }

  // 2. PostgreSQL - production-grade choice
  if (env.hasPostgreSQL) {
    return {
      type: "postgres",
      connection: process.env.DATABASE_URL,
      dialect: "postgres",
    };
  }

  // 3. MySQL/MariaDB - traditional choice
  if (env.hasMySQL) {
    return {
      type: "mysql",
      connection: process.env.DATABASE_URL,
      dialect: "mysql",
    };
  }

  // 4. SQL Server - enterprise choice
  if (env.hasSQLServer) {
    return {
      type: "mssql",
      connection: process.env.DATABASE_URL,
      dialect: "mssql",
    };
  }

  // 5. SQLite - default fallback choice
  return {
    type: "sqlite",
    connection: new Database(".database.sqlite"),
    dialect: "sqlite",
  };
}

/**
 * Global storage instance
 */
export const storage = createAdaptiveCacheStorage();

/**
 * SecondaryStorage adapter for better-auth
 */
export function createSecondaryStorageAdapter(): SecondaryStorage {
  return {
    async get(key: string): Promise<string | null> {
      try {
        const value = await storage.getItem<string>(`auth:${key}`);
        return value || null;
      } catch {
        return null;
      }
    },

    async set(key: string, value: string, ttl?: number): Promise<void> {
      try {
        if (ttl) {
          await storage.setItem(`auth:${key}`, value, { ttl });
        } else {
          await storage.setItem(`auth:${key}`, value);
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
export function getAdaptiveDatabase() {
  return createAdaptiveDatabaseConfig().connection;
}

/**
 * Direct storage tool functions
 * Simple, explicit cache access without unnecessary abstractions
 */
export const cacheStorage = {
  screenshots: {
    async get(key: string) {
      return await storage.getItemRaw(`screenshot:${key}`);
    },
    async set(key: string, value: Buffer, ttl = 3600) {
      await storage.setItemRaw(`screenshot:${key}`, value, { ttl });
    },
    async remove(key: string) {
      await storage.removeItem(`screenshot:${key}`);
    },
    async has(key: string) {
      return await storage.hasItem(`screenshot:${key}`);
    },
  },

  ogImages: {
    async get(key: string) {
      return await storage.getItemRaw(`og:${key}`);
    },
    async set(key: string, value: Buffer, ttl = 86400) {
      await storage.setItemRaw(`og:${key}`, value, { ttl });
    },
    async remove(key: string) {
      await storage.removeItem(`og:${key}`);
    },
    async has(key: string) {
      return await storage.hasItem(`og:${key}`);
    },
  },

  fonts: {
    async get(key: string) {
      return await storage.getItemRaw(`font:${key}`);
    },
    async set(key: string, value: Buffer, ttl = 86400 * 30) {
      await storage.setItemRaw(`font:${key}`, value, { ttl });
    },
    async remove(key: string) {
      await storage.removeItem(`font:${key}`);
    },
    async has(key: string) {
      return await storage.hasItem(`font:${key}`);
    },
  },

  favicons: {
    async get(key: string) {
      return await storage.getItemRaw(`favicon:${key}`);
    },
    async set(key: string, value: Buffer, ttl = 86400 * 7) {
      await storage.setItemRaw(`favicon:${key}`, value, { ttl });
    },
    async remove(key: string) {
      await storage.removeItem(`favicon:${key}`);
    },
    async has(key: string) {
      return await storage.hasItem(`favicon:${key}`);
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
