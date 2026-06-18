import { Hono } from "hono";
import { env } from "../lib/env";
import { requireAdminApiKey } from "../lib/admin-auth";
import {
  deleteCoachOverride,
  setAdminTier,
  upsertCoachOverride,
  type AdminTier,
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
  type JsonRecord,
} from "../lib/request-validation";
import { parseIntParam, withJsonBody } from "../lib/http";
import {
  getCoaches,
  invalidateCache,
  startBackgroundResync,
} from "../lib/coaches-cache";
import { resolveCoachByEmail } from "../lib/coach-session";
import { createLoginCode } from "../lib/db/auth";
import { sendCoachInvite } from "../lib/email";

export const adminCoachesRoutes = new Hono();

adminCoachesRoutes.use("*", requireAdminApiKey);

adminCoachesRoutes.get("/session", (c) => c.json({ ok: true }));

adminCoachesRoutes.post("/refresh", async (c) => {
  invalidateCache();
  try {
    const { data, source } = await getCoaches();
    return c.json({ refreshed: true, totalCoaches: data.totalCoaches, source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

adminCoachesRoutes.post("/resync", (c) => {
  if (!env.thinkificApiKey || !env.thinkificSubdomain) {
    return c.json(
      {
        error:
          "THINKIFIC_API_KEY and THINKIFIC_SUBDOMAIN are required for resync.",
      },
      400,
    );
  }
  // A full Thinkific fetch outlasts typical HTTP/edge timeouts, so run it in the
  // background and return immediately rather than holding the request open
  // until it 502s. Poll the result via GET /api/coaches.
  const started = startBackgroundResync();
  if (!started) {
    return c.json(
      { started: false, message: "A resync is already in progress." },
      409,
    );
  }
  return c.json(
    {
      started: true,
      message:
        "Resync started in the background; coaches will update when it completes.",
    },
    202,
  );
});

interface InviteResult {
  email: string;
  ok: boolean;
  thinkificUserId?: number;
  error?: string;
}

/** Collect the candidate addresses from either `email` or `emails[]`. */
function readInviteEmails(body: JsonRecord): {
  emails?: string[];
  error?: string;
} {
  const raw = body.emails;
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      return { error: "emails must be an array of strings" };
    }
    if (raw.length === 0) {
      return { error: "emails must not be empty" };
    }
    const emails: string[] = [];
    for (const entry of raw) {
      const parsed = readRequiredEmailField({ email: entry }, "email");
      if (!parsed.email) {
        return { error: parsed.error ?? `invalid email: ${String(entry)}` };
      }
      emails.push(parsed.email);
    }
    return { emails: Array.from(new Set(emails)) };
  }

  const single = readRequiredEmailField(body, "email");
  if (!single.email) {
    return { error: single.error ?? "email is required" };
  }
  return { emails: [single.email] };
}

adminCoachesRoutes.post("/invite", (c) =>
  withJsonBody(c, async (body) => {
    const parsed = readInviteEmails(body);
    if (!parsed.emails) {
      return c.json({ error: parsed.error ?? "email is required" }, 400);
    }

    const base = env.appBaseUrl || new URL(c.req.url).origin;

    // Loaded once so bulk invites can attach coach names without re-fetching.
    const { data } = await getCoaches();
    const coachById = new Map(
      data.coaches.map((coach) => [coach.thinkificUserId, coach]),
    );

    const results: InviteResult[] = [];
    for (const email of parsed.emails) {
      try {
        const resolved = await resolveCoachByEmail(email);
        const code = await createLoginCode(
          resolved.thinkificUserId,
          email,
          env.coachInviteCodeTtlMinutes,
        );
        const accessUrl = `${base}/coach-access?email=${encodeURIComponent(email)}`;
        await sendCoachInvite({
          toEmail: email,
          code,
          coachName: coachById.get(resolved.thinkificUserId)?.fullName,
          accessUrl,
          ttlMinutes: env.coachInviteCodeTtlMinutes,
        });
        results.push({
          email,
          ok: true,
          thinkificUserId: resolved.thinkificUserId,
        });
      } catch (err) {
        results.push({ email, ok: false, error: (err as Error).message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return c.json({ ok: true, sent, total: results.length, results });
  }),
);

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

const ADMIN_TIERS = new Set<AdminTier>(["founder", "master", "instructor"]);

adminCoachesRoutes.put("/:thinkificUserId/tier", (c) =>
  withJsonBody(c, async (body) => {
    const id = parseIntParam(c, "thinkificUserId");
    if (id instanceof Response) return id;

    const { tier } = body;
    if (tier !== null && (typeof tier !== "string" || !ADMIN_TIERS.has(tier as AdminTier))) {
      return c.json(
        { error: "tier must be 'founder', 'master', 'instructor', or null" },
        400,
      );
    }

    await setAdminTier(id, tier as AdminTier | null);
    invalidateCache();
    return c.json({ ok: true, thinkificUserId: id, tier: tier ?? null });
  }),
);

adminCoachesRoutes.delete("/:thinkificUserId/override", async (c) => {
  const id = parseIntParam(c, "thinkificUserId");
  if (id instanceof Response) return id;

  await deleteCoachOverride(id);
  invalidateCache();
  return c.json({ ok: true, thinkificUserId: id });
});
