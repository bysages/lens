import type { Redis } from "ioredis";
import { definePlugin } from "nitro";
import { useStorage } from "nitro/storage";
import redisDriver from "unstorage/drivers/redis";

import { redisClientOptions } from "../utils/redis";

/**
 * The cache mount defaults to in-memory storage (see nitro.config). When
 * REDIS_URL is present at runtime, mount redis over it so the cache is
 * shared across cluster workers and bounded by the Redis instance's
 * maxmemory policy.
 */
export default definePlugin(async () => {
  const url = process.env.REDIS_URL;
  if (!url) return;

  const storage = useStorage();
  // The config-level cache mount already exists; replace it.
  await storage.unmount("cache");
  const driver = redisDriver({
    url,
    base: "lens",
    ...redisClientOptions,
    lib: () => import("ioredis"),
  });

  try {
    // ioredis treats a missing error listener as an unhandled event. Cache
    // callers already degrade locally, so keep reconnect noise throttled.
    const client = (await driver.getInstance?.()) as Redis | undefined;
    let lastErrorAt = 0;
    client?.on("error", (error: Error) => {
      const now = Date.now();
      if (now - lastErrorAt < 30_000) return;
      lastErrorAt = now;
      console.warn("[redis] cache unavailable:", error.message);
    });
  } catch {
    // Cache reads and writes handle the unavailable backend as a cache miss.
  }

  storage.mount("cache", driver);
});
