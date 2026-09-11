import { defineHandler, HTTPError } from "nitro/h3";

import { CDP_ENDPOINT } from "../utils/playwright";

/**
 * Liveness plus browser availability: the browser is the one dependency a
 * crash of which leaves the app otherwise healthy, so the healthcheck must
 * see it.
 */
export default defineHandler(async () => {
  try {
    const response = await fetch(`${CDP_ENDPOINT}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return { status: "ok" };
  } catch {
    throw new HTTPError({ status: 503, message: "Browser endpoint unavailable" });
  }
});
