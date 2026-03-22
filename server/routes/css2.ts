import { defineHandler, HTTPError, getQuery, getRequestURL } from "nitro/h3";

import { generateFontCSS } from "../utils/fonts/css";

export interface FontQuery {
  family?: string | string[];
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

  const families = Array.isArray(query.family) ? query.family : [query.family];
  const display = query.display || "swap";
  const subset = query.subset || "latin";
  const provider = query.provider || "google";
  const proxy = query.proxy !== "false";
  const baseUrl = proxy ? getRequestURL(event).origin : "";
  const userAgent = event.req.headers.get("user-agent");

  // CSS is generated in real-time based on cached metadata - process families in parallel
  const cssArray = await Promise.all(
    families.map((family) =>
      generateFontCSS({
        family,
        display,
        subset,
        provider,
        proxy,
        baseUrl,
        userAgent,
        useV2API: true,
      }),
    ),
  );

  const css = cssArray.join("");

  event.res.headers.set("Content-Type", "text/css; charset=utf-8");
  event.res.headers.set("X-Content-Type-Options", "nosniff");

  return css;
});
