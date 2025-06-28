// Better Auth API handler for all auth routes
import { auth } from "../utils/auth";

export default defineEventHandler((event) => {
  return auth.handler(toWebRequest(event));
});
