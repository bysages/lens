import pkg from "../../package.json";
import { isStorageHealthy } from "../utils/storage";

export default defineEventHandler(async (event) => {
  const baseUrl = getRequestURL(event).origin;

  // Get system information
  const memoryUsage = process.memoryUsage();
  const startTime = Date.now() - process.uptime() * 1000;

  // Check environment
  const isServerless = !!(
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.CF_PAGES ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RENDER_SERVICE_NAME
  );

  // Get adaptive storage health
  const storageHealth = await isStorageHealthy();

  const serviceStatus = {
    name: "Lens Multimedia API Platform",
    description:
      "High-performance multimedia API service for images, fonts, favicons, and web content",
    status: "running",
    version: pkg.version,
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(process.uptime()),
      human: new Date(process.uptime() * 1000).toISOString().substr(11, 8),
      startTime: new Date(startTime).toISOString(),
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: process.env.NODE_ENV || "development",
      isServerless,
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
      },
    },
    endpoints: {
      "Core Services": {
        "/favicon": "Favicon extraction and optimization",
        "/css": "Google Fonts CSS v1 API compatible",
        "/css2": "Google Fonts CSS v2 API compatible",
        "/fonts/*": "Font file proxy service",
        "/webfonts": "Google Fonts metadata API",
        "/og": "Open Graph image generation",
        "/img/*": "IPX-compatible image proxy and processing",
        "/screenshot": "Website screenshot capture service",
        description:
          "All endpoints work without authentication. Authenticated users get higher rate limits.",
        authentication:
          "Optional: Session token or API key (x-api-key header / api_key query parameter)",
        examples: [
          `${baseUrl}/favicon?url=https://github.com&size=64`,
          `${baseUrl}/css2?family=Inter:wght@400;700&display=swap`,
          `${baseUrl}/og?title=Hello World&description=My App&theme=blue`,
          `${baseUrl}/img/w_300,f_webp/https%3A//example.com/image.jpg`,
          `${baseUrl}/screenshot?url=https://example.com&width=1920&height=1080`,
        ],
      },
    },
    features: [
      "🖼️ Website screenshot capture with Playwright",
      "🎨 Dynamic OG image generation",
      "🌐 Self-hosted Google Fonts replacement",
      "🖼️ IPX-compatible image proxy and optimization",
      "🚀 Smart serverless environment detection",
      "💾 Multi-layer adaptive caching (Redis + FileSystem + Memory)",
      "🗄️ Adaptive database support (Turso/PostgreSQL/MySQL/SQLite)",
      "🔒 Flexible authentication with better-auth",
      "⚡ Rate limiting with unified plugin-level management",
      "📱 Mobile viewport and dark mode support",
      "🎯 CORS support and security headers",
    ],
    configuration: {
      storage: {
        status: storageHealth ? "Healthy" : "Unhealthy",
        layers: storageHealth ? "Multi-layer adaptive" : "Memory fallback",
        responsive: storageHealth ? "Yes" : "No",
        drivers: {
          redis: process.env.REDIS_URL ? "Available" : "Not configured",
          filesystem: "Available (fallback)",
          memory: "Available",
        },
        ttl: {
          screenshots: "1 hour",
          ogImages: "1 day",
          favicons: "7 days",
          fonts: "30 days",
          metadata: "1 day",
        },
      },
      database: {
        type: process.env.TURSO_DATABASE_URL
          ? "Turso"
          : process.env.DATABASE_URL?.startsWith("postgres")
            ? "PostgreSQL"
            : process.env.DATABASE_URL?.startsWith("mysql")
              ? "MySQL"
              : process.env.DATABASE_URL?.startsWith("sqlserver")
                ? "SQL Server"
                : "SQLite (fallback)",
        status: "Connected",
        features: ["Kysely ORM", "Auto-migration", "TypeScript support"],
      },
      browser: {
        playwright: "Installed",
        config: process.env.PLAYWRIGHT_BROWSER_CONFIG || "auto",
        serverlessMode: isServerless ? "Active" : "Disabled",
      },
      auth: {
        github: process.env.GITHUB_CLIENT_ID ? "Configured" : "Not configured",
        emailPassword: "Enabled",
        sessionStorage: "Adaptive (secondary storage)",
      },
      domains: {
        allowed: process.env.ALLOWED_DOMAINS
          ? process.env.ALLOWED_DOMAINS.split(",").length + " domains"
          : "All domains allowed",
      },
    },
    links: {
      repository: "https://github.com/bysages/lens",
      documentation: "https://github.com/bysages/lens#readme",
    },
  };

  // Return JSON response with proper headers
  setHeader(event, "Content-Type", "application/json");
  setHeader(event, "Cache-Control", "no-cache");

  return serviceStatus;
});
