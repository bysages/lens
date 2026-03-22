import { ImageResponse } from "@vercel/og";
import { defineHandler } from "nitro";
import { getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";

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

  const title = String(query.title || "Default Title").slice(0, 100);
  const description = query.description ? String(query.description).slice(0, 200) : undefined;
  const width = Math.max(200, Math.min(parseInt(query.width || "1200"), 2000));
  const height = Math.max(200, Math.min(parseInt(query.height || "630"), 2000));
  const fontSize = Math.max(12, Math.min(parseInt(query.fontSize || "48"), 120));
  const theme: "light" | "dark" | "blue" | "green" =
    query.theme === "light" ||
    query.theme === "dark" ||
    query.theme === "blue" ||
    query.theme === "green"
      ? query.theme
      : "light";

  const cacheKey = `og:${hash(query)}.png`;
  const storage = useStorage("cache");
  const cached = await storage.getItemRaw<Uint8Array>(cacheKey);

  if (cached) {
    event.res.headers.set("X-Cache", "HIT");
    event.res.headers.set("Content-Type", "image/png");
    return Buffer.from(cached);
  }

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
  const buffer = Buffer.from(await imageResponse.arrayBuffer());

  await storage.setItemRaw(cacheKey, new Uint8Array(buffer));

  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Content-Type", "image/png");

  return buffer;
});
