/**
 * Unified rate limiting configuration for Lens
 *
 * Simplified Architecture:
 * 1. Global Better Auth rate limiting (for auth endpoints only)
 * 2. Plugin-specific rate limiting (for service endpoints)
 *
 * Note: API key users are treated as authenticated users by Better Auth
 */

export interface RateLimitRule {
  max: number;
  window: number; // seconds
  description?: string;
}

/**
 * Global rate limiting configuration for Better Auth
 * This applies ONLY to authentication endpoints (/sign-in, /sign-up, etc.)
 */
export const globalRateLimit = {
  enabled: true,
  window: 3600, // 1 hour
  max: 200, // Base limit for authenticated users
  storage: "secondary-storage" as const,
};

/**
 * Plugin-specific rate limits for service endpoints
 * These handle both authenticated and unauthenticated users
 */
export const pluginRateLimits = {
  image: [
    {
      pathMatcher: (path: string) => path.startsWith("/img/"),
      max: 1000, // Total requests per hour (all users combined)
      window: 3600,
    },
  ],

  screenshot: [
    {
      pathMatcher: (path: string) => path.startsWith("/screenshot"),
      max: 200, // Total requests per hour
      window: 3600,
    },
  ],

  og: [
    {
      pathMatcher: (path: string) => path.startsWith("/og"),
      max: 200, // Total requests per hour
      window: 3600,
    },
  ],

  favicon: [
    {
      pathMatcher: (path: string) => path.startsWith("/favicon"),
      max: 400, // Total requests per hour
      window: 3600,
    },
  ],

  fonts: [
    {
      pathMatcher: (path: string) => path.startsWith("/css"),
      max: 2000, // Total requests per hour
      window: 3600,
    },
    {
      pathMatcher: (path: string) => path.startsWith("/fonts/"),
      max: 4000, // Total requests per hour
      window: 3600,
    },
    {
      pathMatcher: (path: string) => path.startsWith("/webfonts"),
      max: 1000, // Total requests per hour
      window: 3600,
    },
  ],
};

/**
 * Create Better Auth custom rules (empty - we use plugin-level limits instead)
 * This avoids conflicts between Better Auth and plugin rate limiting
 */
export function createCustomRules(): Record<
  string,
  { max: number; window: number }
> {
  // Return empty object to avoid conflicts with plugin rate limits
  return {};
}
