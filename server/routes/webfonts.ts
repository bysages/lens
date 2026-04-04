import { defineHandler, getQuery } from "nitro/h3";
import { useStorage } from "nitro/storage";
import { hash } from "ohash";

import { FONT_META_TTL } from "../utils/constants";
import { getWebfontsList } from "../utils/fonts/webfonts";

export interface WebfontsQuery {
  provider?: string;
  sort?: string;
  family?: string;
  subset?: string;
  category?: string;
}

export default defineHandler(async (event) => {
  const query = getQuery<WebfontsQuery>(event);

  const provider = query.provider || "google";
  const sort = query.sort || "";
  const family = query.family;
  const subset = query.subset;
  const category = query.category;

  const cacheKey = `webfonts:${hash({ provider, sort, family, subset, category })}.json`;
  const storage = useStorage("cache");
  const cached = await storage.getItem(cacheKey);

  if (cached) {
    event.res.headers.set("X-Cache", "HIT");
    return cached;
  }

  const response = await getWebfontsList(provider, { family, subset, category }, sort);

  await storage.setItem(cacheKey, response, { ttl: FONT_META_TTL }); // 1 hour

  event.res.headers.set("X-Cache", "MISS");

  return response;
});
