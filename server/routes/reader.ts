import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";
import TurndownService from "turndown";

import {
  BROWSER_RATE_LIMIT,
  BROWSER_RATE_WINDOW,
  BROWSER_TTL,
  CACHE_MEDIUM,
} from "../utils/constants";
import { extractContent } from "../utils/playwright";
import { rateLimit } from "../utils/rate-limit";

export interface ReaderQuery {
  url: string;
  format?: string;
  waitUntil?: string;
  delay?: string;
  timeout?: string;
}

export default defineHandler(async (event) => {
  const query = getQuery<ReaderQuery>(event);

  if (!query.url) {
    throw new HTTPError({
      status: 400,
      message: "Missing url parameter",
    });
  }

  let url = query.url;
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }

  const format = query.format === "markdown" ? "markdown" : "html";
  const waitUntil = (query.waitUntil || "domcontentloaded") as
    | "load"
    | "domcontentloaded"
    | "networkidle";
  const delay = query.delay ? Math.min(Math.max(parseInt(query.delay), 0), 10000) : undefined;
  const timeout = query.timeout
    ? Math.min(Math.max(parseInt(query.timeout), 1000), 30000)
    : undefined;

  // Generate cache key
  const cacheParams = { url, format, waitUntil, delay, timeout };
  const cacheKey = `reader:${hash(cacheParams)}`;
  const storage = useStorage("cache");
  const etag = `"${cacheKey}"`;
  const cached = await storage.getItem<string>(cacheKey);

  if (cached) {
    if (event.req.headers.get("if-none-match") === etag) {
      event.res.status = 304;
      return null;
    }
    event.res.headers.set("ETag", etag);
    event.res.headers.set("X-Cache", "HIT");
    event.res.headers.set(
      "Content-Type",
      format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
    );
    event.res.headers.set("Cache-Control", CACHE_MEDIUM);
    return cached;
  }

  await rateLimit(event, { limit: BROWSER_RATE_LIMIT, window: BROWSER_RATE_WINDOW });

  // Extract article content via Playwright + Readability
  const article = await extractContent({ url, waitUntil, delay, timeout });

  if (!article.content) {
    throw new HTTPError({
      status: 422,
      message: "Could not extract article content from the page",
    });
  }

  let content: string;

  if (format === "markdown") {
    const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
    content = turndown.turndown(article.content);
  } else {
    content = article.content;
  }

  // Non-blocking cache write
  event.waitUntil(storage.setItem(cacheKey, content, { ttl: BROWSER_TTL }));

  event.res.headers.set("ETag", etag);
  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set(
    "Content-Type",
    format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
  );
  event.res.headers.set("Cache-Control", CACHE_MEDIUM);

  return content;
});
