import { fetch } from "nitro";
import { defineJsonRpcHandler, HTTPError } from "nitro/h3";

import { version } from "../../package.json";

// ── MCP Protocol Methods ─────────────────────────────────

export default defineJsonRpcHandler({
  methods: {
    initialize: () => ({
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: "lens",
        version,
      },
    }),

    ping: () => ({}),

    "notifications/initialized": () => {},

    "tools/list": () => ({
      tools: [
        {
          name: "reader",
          description:
            "Extract article content from a URL as cleaned HTML or Markdown. Returns title, content, and metadata.",
          inputSchema: {
            type: "object" as const,
            properties: {
              url: { type: "string", description: "Website URL to extract content from" },
              format: {
                type: "string",
                enum: ["html", "markdown"],
                description: "Output format (default: html)",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "screenshot",
          description: "Capture a screenshot of a website. Returns a base64-encoded image.",
          inputSchema: {
            type: "object" as const,
            properties: {
              url: { type: "string", description: "Website URL to screenshot" },
              width: {
                type: "number",
                description: "Viewport width in pixels (100-2560, default: 1280)",
              },
              height: {
                type: "number",
                description: "Viewport height in pixels (100-1440, default: 720)",
              },
              type: {
                type: "string",
                enum: ["png", "jpeg"],
                description: "Output format (default: png)",
              },
              fullPage: { type: "boolean", description: "Capture full scrollable page" },
              quality: { type: "number", description: "Image quality 1-100 (jpeg only)" },
            },
            required: ["url"],
          },
        },
        {
          name: "favicon",
          description: "Extract the favicon of a website. Returns a base64-encoded PNG image.",
          inputSchema: {
            type: "object" as const,
            properties: {
              url: { type: "string", description: "Website URL or domain" },
              size: { type: "number", description: "Favicon size in pixels (16-256, default: 64)" },
            },
            required: ["url"],
          },
        },
        {
          name: "og",
          description:
            "Generate a dynamic Open Graph image with custom title, description, and styling.",
          inputSchema: {
            type: "object" as const,
            properties: {
              title: { type: "string", description: "Main title text (max 100 chars)" },
              description: { type: "string", description: "Description text (max 200 chars)" },
              width: {
                type: "number",
                description: "Image width in pixels (200-2000, default: 1200)",
              },
              height: {
                type: "number",
                description: "Image height in pixels (200-2000, default: 630)",
              },
              fontSize: { type: "number", description: "Title font size (12-120, default: 48)" },
              theme: {
                type: "string",
                enum: ["light", "dark", "blue", "green"],
                description: "Color theme (default: light)",
              },
            },
            required: ["title"],
          },
        },
        {
          name: "gravatar",
          description:
            "Get a Gravatar avatar by email or MD5 hash. Returns a base64-encoded image.",
          inputSchema: {
            type: "object" as const,
            properties: {
              email: { type: "string", description: "Email address (will be MD5 hashed)" },
              hash: { type: "string", description: "Pre-computed MD5 hash (alternative to email)" },
              size: { type: "number", description: "Image size in pixels (default: 80)" },
              default: {
                type: "string",
                enum: [
                  "404",
                  "mp",
                  "identicon",
                  "monsterid",
                  "wavatar",
                  "retro",
                  "robohash",
                  "blank",
                ],
                description: "Default image when no gravatar found",
              },
            },
          },
        },
        {
          name: "img",
          description:
            "Transform and optimize an image (resize, crop, format convert, quality adjust). Returns a base64-encoded image.",
          inputSchema: {
            type: "object" as const,
            properties: {
              url: { type: "string", description: "Source image URL" },
              width: { type: "number", description: "Output width in pixels" },
              height: { type: "number", description: "Output height in pixels" },
              format: {
                type: "string",
                enum: ["webp", "jpg", "png", "avif"],
                description: "Output format conversion",
              },
              quality: { type: "number", description: "Output quality 1-100" },
              fit: {
                type: "string",
                enum: ["cover", "contain", "fill", "inside", "outside"],
                description: "Resize fit mode",
              },
            },
            required: ["url"],
          },
        },
      ],
    }),

    "tools/call": async ({ params }) => {
      const { name, arguments: args } = params as {
        name: string;
        arguments: Record<string, unknown>;
      };

      switch (name) {
        case "reader": {
          const { url, format } = args;
          if (typeof url !== "string") {
            throw new HTTPError({ status: 400, message: "Missing or invalid 'url' parameter" });
          }

          const searchParams = new URLSearchParams({ url });
          if (format === "markdown") searchParams.set("format", "markdown");

          const res = await fetch(`/reader?${searchParams}`);

          if (!res.ok) {
            return {
              content: [
                { type: "text" as const, text: `Failed to extract content: ${res.status}` },
              ],
              isError: true,
            };
          }

          const content = await res.text();
          return {
            content: [{ type: "text" as const, text: content }],
          };
        }

        case "screenshot": {
          const { url, width, height, type, fullPage, quality } = args;
          if (typeof url !== "string") {
            throw new HTTPError({ status: 400, message: "Missing or invalid 'url' parameter" });
          }

          const searchParams = new URLSearchParams({ url });
          if (typeof width === "number") searchParams.set("width", String(width));
          if (typeof height === "number") searchParams.set("height", String(height));
          if (type === "jpeg") searchParams.set("type", "jpeg");
          if (fullPage === true) searchParams.set("fullPage", "true");
          if (typeof quality === "number") searchParams.set("quality", String(quality));

          const res = await fetch(`/screenshot?${searchParams}`);

          if (!res.ok) {
            return {
              content: [
                { type: "text" as const, text: `Failed to capture screenshot: ${res.status}` },
              ],
              isError: true,
            };
          }

          const buffer = Buffer.from(await res.bytes());
          const mimeType = type === "jpeg" ? "image/jpeg" : "image/png";

          return {
            content: [
              {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType,
              },
            ],
          };
        }

        case "favicon": {
          const { url, size } = args;
          if (typeof url !== "string") {
            throw new HTTPError({ status: 400, message: "Missing or invalid 'url' parameter" });
          }

          const searchParams = new URLSearchParams({ url });
          if (typeof size === "number") searchParams.set("size", String(size));

          const res = await fetch(`/favicon?${searchParams}`);

          if (!res.ok) {
            return {
              content: [
                { type: "text" as const, text: `Failed to extract favicon: ${res.status}` },
              ],
              isError: true,
            };
          }

          const buffer = Buffer.from(await res.bytes());

          return {
            content: [
              {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType: "image/png",
              },
            ],
          };
        }

        case "og": {
          const { title, description, width, height, fontSize, theme } = args;
          if (typeof title !== "string") {
            throw new HTTPError({ status: 400, message: "Missing or invalid 'title' parameter" });
          }

          const searchParams = new URLSearchParams({ title });
          if (typeof description === "string") searchParams.set("description", description);
          if (typeof width === "number") searchParams.set("width", String(width));
          if (typeof height === "number") searchParams.set("height", String(height));
          if (typeof fontSize === "number") searchParams.set("fontSize", String(fontSize));
          if (typeof theme === "string") searchParams.set("theme", theme);

          const res = await fetch(`/og?${searchParams}`);

          if (!res.ok) {
            return {
              content: [
                { type: "text" as const, text: `Failed to generate OG image: ${res.status}` },
              ],
              isError: true,
            };
          }

          const buffer = Buffer.from(await res.bytes());

          return {
            content: [
              {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType: "image/png",
              },
            ],
          };
        }

        case "gravatar": {
          const { email, hash, size, default: defaultImg } = args;
          if (typeof email !== "string" && typeof hash !== "string") {
            throw new HTTPError({ status: 400, message: "Missing 'email' or 'hash' parameter" });
          }

          const searchParams = new URLSearchParams();
          if (typeof email === "string") searchParams.set("email", email);
          if (typeof hash === "string") searchParams.set("hash", hash);
          if (typeof size === "number") searchParams.set("size", String(size));
          if (typeof defaultImg === "string") searchParams.set("default", defaultImg);

          const res = await fetch(`/gravatar?${searchParams}`);

          if (!res.ok) {
            return {
              content: [{ type: "text" as const, text: `Failed to fetch gravatar: ${res.status}` }],
              isError: true,
            };
          }

          const buffer = Buffer.from(await res.bytes());
          const contentType = res.headers.get("content-type") || "image/png";

          return {
            content: [
              {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType: contentType,
              },
            ],
          };
        }

        case "img": {
          const { url, width, height, format, quality, fit } = args;
          if (typeof url !== "string") {
            throw new HTTPError({ status: 400, message: "Missing or invalid 'url' parameter" });
          }

          // Build IPX modifier path: /img/{modifiers}/{image_url}
          const modifiers: string[] = [];
          if (typeof width === "number" && typeof height === "number")
            modifiers.push(`s_${width}x${height}`);
          else if (typeof width === "number") modifiers.push(`w_${width}`);
          else if (typeof height === "number") modifiers.push(`h_${height}`);
          if (typeof format === "string") modifiers.push(`f_${format}`);
          if (typeof quality === "number") modifiers.push(`q_${quality}`);
          if (typeof fit === "string") modifiers.push(`c_${fit}`);

          const modifierStr = modifiers.length > 0 ? modifiers.join(",") + "/" : "";
          const res = await fetch(`/img/${modifierStr}${url}`);

          if (!res.ok) {
            return {
              content: [{ type: "text" as const, text: `Failed to process image: ${res.status}` }],
              isError: true,
            };
          }

          const buffer = Buffer.from(await res.bytes());
          const contentType = res.headers.get("content-type") || "image/png";

          return {
            content: [
              {
                type: "image" as const,
                data: buffer.toString("base64"),
                mimeType: contentType,
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    },
  },
});
