import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import {
  createIPX,
  ipxHttpStorage,
  unstorageToIPXStorage,
  createIPXWebServer,
  type IPX,
  type HTTPStorageOptions,
} from "ipx";
import { cpus } from "os";
import { storage } from "./storage";
import { pluginRateLimits } from "./rate-limits";

/**
 * Image processing configuration
 */
interface ImageConfig {
  maxAge: number;
  allowedDomains: string[];
  allowAllDomains: boolean;
}

/**
 * Create secure image processing configuration
 */
function createImageConfig(): ImageConfig {
  const allowedDomains =
    process.env.ALLOWED_DOMAINS?.split(",")
      .map((d) => d.trim())
      .filter(Boolean) || [];

  return {
    maxAge: 86400, // 24 hours cache
    allowedDomains,
    allowAllDomains: allowedDomains.length === 0,
  };
}

/**
 * Optimized image processing with cached IPX instance
 */
import { isMemoryPressure, registerCleanup } from "./memory";

let cachedIPXInstance: IPX | null = null;
let processingCount = 0;
const MAX_CONCURRENT_PROCESSING = Math.max(2, Math.floor(cpus().length / 2));

// Simple concurrent processing check
function isProcessingOverloaded(): boolean {
  return processingCount > MAX_CONCURRENT_PROCESSING || isMemoryPressure();
}

function createImageProcessor(): IPX {
  // Return cached instance if available
  if (cachedIPXInstance) {
    return cachedIPXInstance;
  }

  const config = createImageConfig();

  // Pre-built HTTP storage options
  const httpStorageOptions: HTTPStorageOptions = {
    domains: config.allowedDomains,
    allowAllDomains: config.allowAllDomains,
    maxAge: config.maxAge,
    fetchOptions: {
      headers: {
        "User-Agent": "Lens Image Proxy/1.0",
        Accept: "image/*,*/*;q=0.8",
        "Cache-Control": "max-age=3600",
      },
    },
    ignoreCacheControl: false,
  };

  // Create IPX with optimized settings
  cachedIPXInstance = createIPX({
    maxAge: config.maxAge,
    storage: unstorageToIPXStorage(storage, { prefix: "img:" }),
    httpStorage: ipxHttpStorage(httpStorageOptions),
    sharpOptions: {
      limitInputPixels: 268402689, // 16384 x 16384 pixels max
      sequentialRead: true, // Better for large images
      density: 72, // Default density for web
      failOnError: false, // Graceful degradation
    },
  });

  // Register cleanup callback for IPX instance
  registerCleanup(async () => {
    processingCount = 0;
    cachedIPXInstance = null; // Reset for recreation
  });

  return cachedIPXInstance;
}

/**
 * IPX-powered image processing plugin for better-auth
 */
export const imagePlugin = (): BetterAuthPlugin => {
  const ipx = createImageProcessor();
  const webHandler = createIPXWebServer(ipx);

  return {
    id: "image",

    rateLimit: pluginRateLimits.image,

    endpoints: {
      processImage: createAuthEndpoint(
        "/img/*",
        {
          method: "GET",
        },
        async (ctx) => {
          try {
            // Check if processing capacity exceeded
            if (isProcessingOverloaded()) {
              return new Response(
                JSON.stringify({
                  error: "Service Temporarily Unavailable",
                  message:
                    "Image processing capacity exceeded. Please try again later.",
                }),
                {
                  status: 503,
                  headers: {
                    "Content-Type": "application/json",
                    "Retry-After": "30",
                  },
                },
              );
            }

            // Increment processing counter
            processingCount++;

            try {
              // Create a new request with the correct path for IPX
              // Remove /img prefix from the URL path
              const url = new URL(ctx.request.url);
              const ipxPath = url.pathname.replace(/^\/img/, "") || "/";
              url.pathname = ipxPath;

              const ipxRequest = new Request(url.toString(), {
                method: ctx.request.method,
                headers: ctx.request.headers,
              });

              // Use IPX Web Server to process the request with timeout
              const response = await Promise.race([
                webHandler(ipxRequest),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error("Processing timeout")),
                    30000,
                  ),
                ),
              ]);

              return response;
            } finally {
              // Always decrement counter
              processingCount--;
            }
          } catch (error) {
            // Handle IPX errors
            if (error instanceof Error) {
              // Security-related errors
              if (
                error.message.includes("not allowed") ||
                error.message.includes("Invalid URL")
              ) {
                return new Response(
                  JSON.stringify({
                    error: "Forbidden",
                    message: "Access to this resource is not allowed",
                  }),
                  {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                  },
                );
              }

              // Bad request errors
              if (
                error.message.includes("Invalid") ||
                error.message.includes("Bad Request")
              ) {
                return new Response(
                  JSON.stringify({
                    error: "Bad Request",
                    message: "Invalid image request format",
                  }),
                  {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                  },
                );
              }
            }

            // Generic error for processing failures
            return new Response(
              JSON.stringify({
                error: "Image processing failed",
                message: "Unable to process the requested image",
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        },
      ),
    },
  };
};
