import { defineHandler, HTTPError, getQuery } from "nitro/h3";
import { hash } from "ohash";

import { serveCached } from "../utils/cache";
import {
  BROWSER_RATE_LIMIT,
  BROWSER_TTL,
  CACHE_MEDIUM,
  MAX_CACHE_ENTRY_BYTES,
  RATE_WINDOW,
} from "../utils/constants";
import { turndown } from "../utils/markdown";
import { clampInt, firstString, oneOf } from "../utils/params";
import { extractContent } from "../utils/playwright";
import { rateLimit } from "../utils/rate-limit";
import { assertSafeUrl, normalizeInputUrl } from "../utils/ssrf";

export interface ReaderQuery {
  url: string;
  format?: string;
  waitUntil?: string;
  delay?: string;
  timeout?: string;
}

export default defineHandler(async (event) => {
  const query = getQuery<ReaderQuery>(event);

  const rawUrl = firstString(query.url);
  if (!rawUrl) {
    throw new HTTPError({ status: 400, message: "Missing url parameter" });
  }
  const url = normalizeInputUrl(rawUrl);
  await assertSafeUrl(url);

  const format = oneOf(query.format, ["html", "markdown"] as const, "markdown")!;
  const waitUntil = oneOf(
    query.waitUntil,
    ["load", "domcontentloaded", "networkidle"] as const,
    "domcontentloaded",
  )!;
  const delay = clampInt(query.delay, 0, 10000);
  const timeout = clampInt(query.timeout, 1000, 30000);

  const cacheKey = `reader:${hash({ url, format, waitUntil, delay, timeout })}`;

  return serveCached(event, {
    key: cacheKey,
    ttl: BROWSER_TTL,
    contentType:
      format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
    cacheControl: CACHE_MEDIUM,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      await rateLimit(event, { limit: BROWSER_RATE_LIMIT, window: RATE_WINDOW, scope: "browser" });

      // Extract article content via Playwright + Readability
      const article = await extractContent({ url, waitUntil, delay, timeout });

      if (!article.content) {
        throw new HTTPError({
          status: 422,
          message: "Could not extract article content from the page",
        });
      }

      return {
        data: format === "markdown" ? turndown.turndown(article.content) : article.content,
      };
    },
  });
});
