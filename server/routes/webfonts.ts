import { defineHandler, getQuery } from "nitro/h3";

import { serveCached } from "../utils/cache";
import { CACHE_SHORT, FONT_META_TTL, MAX_CACHE_ENTRY_BYTES } from "../utils/constants";
import { getWebfontsList } from "../utils/fonts/webfonts";
import { firstString } from "../utils/params";

export interface WebfontsQuery {
  provider?: string;
  sort?: string;
  family?: string;
  subset?: string;
  category?: string;
}

export default defineHandler(async (event) => {
  const query = getQuery<WebfontsQuery>(event);

  const provider = firstString(query.provider) || "google";
  const sort = firstString(query.sort) || "";
  const family = firstString(query.family);
  const subset = firstString(query.subset);
  const category = firstString(query.category);

  return serveCached(event, {
    key: `webfonts:${provider}:${sort}:${family ?? "all"}:${subset ?? "all"}:${category ?? "all"}.json`,
    ttl: FONT_META_TTL,
    contentType: "application/json; charset=utf-8",
    cacheControl: CACHE_SHORT,
    maxBytes: MAX_CACHE_ENTRY_BYTES,
    produce: async () => {
      const response = await getWebfontsList(provider, { family, subset, category }, sort);
      return { data: JSON.stringify(response) };
    },
  });
});
