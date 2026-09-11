import { ImageResponse } from "@vercel/og";
import { defineHandler, getQuery } from "nitro/h3";
import { hash } from "ohash";

import { serveCached } from "../utils/cache";
import {
  CACHE_IMMUTABLE,
  MAX_CACHE_ENTRY_BYTES,
  OG_DEFAULT_HEIGHT,
  OG_DEFAULT_WIDTH,
  OG_IMAGE_TTL,
} from "../utils/constants";
import { clampInt, firstString, oneOf } from "../utils/params";

export interface OGQuery {
  title?: string;
  description?: string;
  width?: string;
  height?: string;
  fontSize?: string;
  theme?: "light" | "dark" | "blue" | "green";
}

export default defineHandler(async (event) => {
  const query = getQuery<OGQuery>(event);

  const title = (firstString(query.title) || "Default Title").slice(0, 100);
  const description = firstString(query.description)?.slice(0, 200);
  const width = clampInt(query.width, 200, 2000, OG_DEFAULT_WIDTH);
  const height = clampInt(query.height, 200, 2000, OG_DEFAULT_HEIGHT);
  const fontSize = clampInt(query.fontSize, 12, 120, 48);
  const theme = oneOf(query.theme, ["light", "dark", "blue", "green"] as const, "light")!;

  const cacheKey = `og:${hash({ title, description, width, height, fontSize, theme })}.png`;

  return serveCached(event, {
    key: cacheKey,
    ttl: OG_IMAGE_TTL,
    contentType: "image/png",
    cacheControl: CACHE_IMMUTABLE,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
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

      const themeStyle = themes[theme];

      const element = {
        type: "div",
        key: "og-container",
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
              key: "og-title",
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
                    key: "og-description",
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

      const imageResponse = new ImageResponse(element, { width, height });
      return { data: Buffer.from(await imageResponse.arrayBuffer()) };
    },
  });
});
