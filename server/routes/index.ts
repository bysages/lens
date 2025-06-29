import pkg from "../../package.json";
import { isStorageHealthy } from "../utils/storage";

export default defineEventHandler(async (event) => {
  const baseUrl = getRequestURL(event).origin;

  // Parallel execution for better performance
  const [storageHealth, memoryUsage] = await Promise.all([
    isStorageHealthy(),
    Promise.resolve(process.memoryUsage()),
  ]);

  const serviceStatus = {
    name: "Lens API",
    version: pkg.version,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || "development",
    health: {
      storage: storageHealth ? "ok" : "degraded",
      memory: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
    },
    services: ["favicon", "fonts", "og", "img", "screenshot"],
    examples: [
      `${baseUrl}/favicon?url=github.com`,
      `${baseUrl}/og?title=Hello&theme=blue`,
      `${baseUrl}/img/w_300/example.com/image.jpg`,
    ],
    features: ["screenshots", "og-images", "fonts", "image-proxy", "caching"],
    storage: {
      redis: !!process.env.REDIS_URL,
      minio: !!(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY),
      s3: !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID),
    },
    docs: "https://github.com/bysages/lens#readme",
  };

  // Cache for 30 seconds to reduce load
  setHeader(event, "Cache-Control", "public, max-age=30");

  return serviceStatus;
});
