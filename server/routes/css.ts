import { defineHandler, HTTPError, getQuery, getRequestURL } from "nitro/h3";

import { CACHE_FONT_CSS } from "../utils/constants";
import { generateFontCSS } from "../utils/fonts/css";

export interface FontQuery {
  family?: string;
  display?: string;
  subset?: string;
  provider?: string;
  proxy?: string;
}

export default defineHandler(async (event) => {
  const query = getQuery<FontQuery>(event);

  if (!query.family) {
    throw new HTTPError({
      status: 400,
      message: "Missing family parameter",
    });
  }

  const display = query.display || "swap";
  const subset = query.subset || "latin";
  const provider = query.provider || "google";
  const proxy = query.proxy !== "false";
  const baseUrl = proxy ? getRequestURL(event).origin : "";
  const userAgent = event.req.headers.get("user-agent");

  // CSS is generated in real-time based on cached metadata
  const css = await generateFontCSS({
    family: query.family,
    display,
    subset,
    provider,
    proxy,
    baseUrl,
    userAgent,
    useV2API: false,
  });

  event.res.headers.set("Content-Type", "text/css; charset=utf-8");
  event.res.headers.set("X-Content-Type-Options", "nosniff");
  event.res.headers.set("Cache-Control", CACHE_FONT_CSS);
  event.res.headers.set("Vary", "User-Agent");

  return css;
});
