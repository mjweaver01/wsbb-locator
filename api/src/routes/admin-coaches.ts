import { Hono } from "hono";
import { env } from "../lib/env";
import { requireAdminApiKey } from "../lib/admin-auth";
import {
  deleteCoachOverride,
  upsertCoachOverride,
} from "../lib/db/overrides";
import {
  deleteCoachEmailLink,
  listCoachEmailLinks,
  upsertCoachEmailLink,
} from "../lib/db/email-links";
import {
  parseCoachOverride,
  readOptionalStringField,
  readRequiredEmailField,
} from "../lib/request-validation";
import { parseIntParam, withJsonBody } from "../lib/http";
import {
  getCoaches,
  invalidateCache,
  resyncFromThinkific,
} from "../lib/coaches-cache";
import { resolveCoachByEmail } from "../lib/coach-session";

export const adminCoachesRoutes = new Hono();

adminCoachesRoutes.use("*", requireAdminApiKey);

adminCoachesRoutes.post("/refresh", async (c) => {
  invalidateCache();
  try {
    const { data, source } = await getCoaches();
    return c.json({ refreshed: true, totalCoaches: data.totalCoaches, source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

adminCoachesRoutes.post("/resync", async (c) => {
  if (!env.thinkificApiKey || !env.thinkificSubdomain) {
    return c.json(
      {
        error:
          "THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN are required for resync.",
      },
      400,
    );
  }
  try {
    const data = await resyncFromThinkific();
    return c.json({
      resynced: true,
      source: "thinkific",
      totalCoaches: data.totalCoaches,
      fetchedAt: data.fetchedAt,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

adminCoachesRoutes.get("/resolve-user", async (c) => {
  const email = c.req.query("email");
  if (!email) return c.json({ error: "email query param is required" }, 400);
  try {
    const resolved = await resolveCoachByEmail(email);
    return c.json({
      found: true,
      thinkificUserId: resolved.thinkificUserId,
      source: resolved.source,
    });
  } catch {
    return c.json({ found: false });
  }
});

adminCoachesRoutes.get("/:thinkificUserId/email-links", async (c) => {
  const id = parseIntParam(c, "thinkificUserId");
  if (id instanceof Response) return id;
  return c.json({ thinkificUserId: id, links: await listCoachEmailLinks(id) });
});

adminCoachesRoutes.put("/:thinkificUserId/email-links", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }
    const source = readOptionalStringField(body, "source");
    if (source !== undefined && source.trim() === "") {
      return c.json({ error: "source must not be empty when provided" }, 400);
    }

    const link = await upsertCoachEmailLink(id, parsedEmail.email, source);
    return c.json({ ok: true, link });
  }),
);

adminCoachesRoutes.delete("/:thinkificUserId/email-links", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }

    const removed = await deleteCoachEmailLink(id, parsedEmail.email);
    return c.json({ ok: true, removed });
  }),
);

adminCoachesRoutes.put("/:thinkificUserId/override", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const parsed = parseCoachOverride(body);
    if (!parsed.override) {
      return c.json({ error: parsed.error ?? "Invalid override" }, 400);
    }

    const saved = await upsertCoachOverride(id, parsed.override);
    invalidateCache();
    return c.json({ ok: true, thinkificUserId: id, override: saved });
  }),
);

adminCoachesRoutes.delete("/:thinkificUserId/override", async (c) => {
  const id = parseIntParam(c, "thinkificUserId");
  if (id instanceof Response) return id;

  await deleteCoachOverride(id);
  invalidateCache();
  return c.json({ ok: true, thinkificUserId: id });
});
