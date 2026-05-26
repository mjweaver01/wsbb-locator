import type { Context, Next } from "hono";
import { env } from "./env";

function getAdminApiKeyFromRequest(c: Context): string | null {
  const bearer = c.req.header("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }
  const headerKey = c.req.header("x-admin-api-key");
  return headerKey?.trim() || null;
}

export async function requireAdminApiKey(c: Context, next: Next) {
  if (!env.coachAdminApiKey) {
    return c.json(
      { error: "Admin API key is not configured on this server." },
      503,
    );
  }

  const provided = getAdminApiKeyFromRequest(c);
  if (!provided || provided !== env.coachAdminApiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
}
