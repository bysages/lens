import { definePlugin } from "nitro";
import { useStorage } from "nitro/storage";
import redisDriver from "unstorage/drivers/redis";

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
  storage.mount("cache", redisDriver({ url, base: "lens" }));
});
