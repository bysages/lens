import { ImageResponse } from "@vercel/og";
import { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { cacheStorage } from "./storage";
import { pluginRateLimits } from "./rate-limits";

// Copy only essential types from @vercel/og
type ImageResponseOptions = {
  width?: number;
  height?: number;
  debug?: boolean;
  fonts?: {
    data: Buffer | ArrayBuffer;
    name: string;
    weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
    style?: "normal" | "italic";
  }[];
} & ConstructorParameters<typeof Response>[1];

/**
 * Generates OG image from query parameters
 */
export async function generateOGImage(
  query: Record<string, string | string[]>,
): Promise<{ buffer: Buffer; contentType: string }> {
  // Parse and validate parameters
  const title = String(query.title || "Default Title").slice(0, 100);
  const description = query.description
    ? String(query.description).slice(0, 200)
    : undefined;
  const width = Math.max(
    200,
    Math.min(parseInt(String(query.width)) || 1200, 2000),
  );
  const height = Math.max(
    200,
    Math.min(parseInt(String(query.height)) || 630, 2000),
  );
  const fontSize = Math.max(
    12,
    Math.min(parseInt(String(query.fontSize)) || 48, 120),
  );
  const theme = ["light", "dark", "blue", "green"].includes(String(query.theme))
    ? String(query.theme)
    : "light";

  // Generate cache key
  const cacheKey = `og:${title}:${description}:${width}:${height}:${fontSize}:${theme}`;

  // Check cache
  const cached = await cacheStorage.ogImages.get(cacheKey);
  if (cached) {
    return { buffer: cached, contentType: "image/png" };
  }

  // Theme styles
  const themes = {
    light: { background: "#ffffff", color: "#1a1a1a" },
    dark: { background: "#1a1a1a", color: "#ffffff" },
    blue: {
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      color: "#ffffff",
    },
    green: {
      background: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
      color: "#1a1a1a",
    },
  };

  const themeStyle = themes[theme as keyof typeof themes];

  // Build JSX structure
  const element = {
    type: "div",
    key: "og",
    props: {
      style: {
        background: themeStyle.background,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter",
        color: themeStyle.color,
        padding: "40px",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              fontSize,
              fontWeight: "bold",
              marginBottom: description ? "24px" : "0",
              textAlign: "center",
              maxWidth: "90%",
            },
            children: title,
          },
        },
        ...(description
          ? [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: Math.floor(fontSize * 0.5),
                    textAlign: "center",
                    maxWidth: "80%",
                    opacity: 0.8,
                  },
                  children: description,
                },
              },
            ]
          : []),
      ],
    },
  };

  try {
    const options: ImageResponseOptions = { width, height };
    const imageResponse = new ImageResponse(element, options);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    // Cache result
    await cacheStorage.ogImages.set(cacheKey, buffer);

    return { buffer, contentType: "image/png" };
  } catch (error) {
    throw new Error(
      `OG image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export const ogPlugin = (): BetterAuthPlugin => {
  return {
    id: "og",

    rateLimit: pluginRateLimits.og,

    endpoints: {
      // OG image generation endpoint
      generateOG: createAuthEndpoint(
        "/og",
        {
          method: "GET",
        },
        async (ctx) => {
          try {
            // Generate OG image
            const { buffer, contentType } = await generateOGImage(ctx.query);

            return new Response(buffer, {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400", // 24 hours cache for better performance
              },
            });
          } catch (error) {
            return new Response(
              JSON.stringify({
                error: "OG image generation failed",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }
        },
      ),
    },
  };
};
