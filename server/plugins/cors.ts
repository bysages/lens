import { definePlugin } from "nitro";

/**
 * Route rules answer browser preflights, while this final-response hook keeps
 * CORS headers on error responses so browser clients can read API errors.
 */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", (response) => {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Expose-Headers", "*");
  });
});
