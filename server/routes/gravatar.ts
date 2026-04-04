import { createHash } from "node:crypto";

import { defineHandler, HTTPError, getRequestURL, getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";

import { CACHE_LONG, GRAVATAR_TTL } from "../utils/constants";

const GRAVATAR_BASE = "https://www.gravatar.com/avatar";

export default defineHandler(async (event) => {
  const query = getQuery(event);

  if (!query.email && !query.hash) {
    throw new HTTPError({
      status: 400,
      message: "Missing email or hash parameter",
    });
  }

  const md5 =
    query.hash ||
    createHash("md5")
      .update((query.email as string).trim().toLowerCase())
      .digest("hex");

  // Forward all query params except email/hash
  const params = new URLSearchParams(getRequestURL(event).search);
  params.delete("email");
  params.delete("hash");
  const search = params.toString();
  const gravatarUrl = `${GRAVATAR_BASE}/${md5}${search ? `?${search}` : ""}`;
  const cacheKey = `gravatar:${md5}${search ? `:${hash(search)}` : ""}`;

  const storage = useStorage("cache");
  const cached = await storage.getItemRaw<Uint8Array>(cacheKey);

  if (cached) {
    const cachedMeta = await storage.getMeta(cacheKey);
    const contentType =
      typeof cachedMeta?.contentType === "string" ? cachedMeta.contentType : "image/png";
    event.res.headers.set("Content-Type", contentType);
    event.res.headers.set("X-Cache", "HIT");
    event.res.headers.set("Cache-Control", CACHE_LONG);
    return cached;
  }

  const response = await fetch(gravatarUrl);

  if (!response.ok) {
    throw new HTTPError({
      status: response.status,
      message: "Failed to fetch gravatar",
    });
  }

  const data = await response.bytes();

  const contentType = response.headers.get("content-type") || "image/png";
  event.res.headers.set("Content-Type", contentType);
  event.res.headers.set("X-Cache", "MISS");
  event.res.headers.set("Cache-Control", CACHE_LONG);

  event.waitUntil(
    Promise.all([
      storage.setItemRaw(cacheKey, data, { ttl: GRAVATAR_TTL }),
      storage.setMeta(cacheKey, { contentType }, { ttl: GRAVATAR_TTL }),
    ]),
  );

  return data;
});
