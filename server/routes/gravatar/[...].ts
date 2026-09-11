import { createHash } from "node:crypto";

import { defineHandler, HTTPError, getRequestURL, getQuery, getRouterParam } from "nitro/h3";
import { hash } from "ohash";

import { serveCached } from "../../utils/cache";
import {
  CACHE_LONG,
  GRAVATAR_RATE_LIMIT,
  GRAVATAR_TTL,
  MAX_CACHE_ENTRY_BYTES,
  RATE_WINDOW,
} from "../../utils/constants";
import { firstString } from "../../utils/params";
import { rateLimit } from "../../utils/rate-limit";
import { safeFetch } from "../../utils/ssrf";

const GRAVATAR_BASE = "https://www.gravatar.com/avatar";
const MD5_PATTERN = /^[a-f0-9]{32}$/i;

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const pathHash = getRouterParam(event, "_");

  // Path format: /gravatar/{md5}?size=200 — use path directly, ignore email/hash
  // Query format: /gravatar?email=xxx or /gravatar?hash=xxx
  // The hash doubles as the storage key and URL path segment, so it must be
  // a well-formed MD5 before anything else happens
  let md5: string;
  if (pathHash || query.hash !== undefined) {
    const candidate = pathHash ?? firstString(query.hash);
    if (!candidate || !MD5_PATTERN.test(candidate)) {
      throw new HTTPError({ status: 400, message: "Invalid MD5 hash" });
    }
    md5 = candidate;
  } else {
    const email = firstString(query.email);
    if (!email) {
      throw new HTTPError({ status: 400, message: "Missing email, hash parameter, or path hash" });
    }
    md5 = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  }

  // Forward all query params except email/hash
  const params = new URLSearchParams(getRequestURL(event).search);
  params.delete("email");
  params.delete("hash");
  const search = params.toString();
  const gravatarUrl = `${GRAVATAR_BASE}/${md5}${search ? `?${search}` : ""}`;
  const cacheKey = `gravatar:${md5}${search ? `:${hash(search)}` : ""}`;

  return serveCached(event, {
    key: cacheKey,
    ttl: GRAVATAR_TTL,
    contentType: "image/png",
    cacheControl: CACHE_LONG,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      await rateLimit(event, {
        limit: GRAVATAR_RATE_LIMIT,
        window: RATE_WINDOW,
        scope: "gravatar",
      });

      const response = await safeFetch(gravatarUrl, { signal: AbortSignal.timeout(10000) });
      if (!response || !response.ok) {
        throw new HTTPError({
          status: response?.status ?? 502,
          message: "Failed to fetch gravatar",
        });
      }
      return {
        data: Buffer.from(await response.bytes()),
        contentType: response.headers.get("content-type") || "image/png",
      };
    },
  });
});
