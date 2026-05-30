import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { env } from "../lib/env";
import {
  createCoachSession,
  createLoginCode,
  deleteCoachSession,
  verifyAndConsumeLoginCode,
} from "../lib/db/auth";
import { getCoachOverride, upsertCoachOverride } from "../lib/db/overrides";
import { geocodeAddress } from "../lib/geocode";
import { sendCoachLoginCode } from "../lib/email";
import {
  parseCoachOverride,
  readRequiredCodeField,
  readRequiredEmailField,
} from "../lib/request-validation";
import { checkRateLimit } from "../lib/rate-limit";
import { getClientIp, withJsonBody } from "../lib/http";
import {
  buildCoachMediaFilename,
  deleteCoachMedia,
  saveCoachMedia,
} from "../lib/coach-media";
import {
  buildCoachMediaUrl,
  resolveManagedCoachMediaFilename,
} from "../lib/coach-media-url";
import { invalidateCache } from "../lib/coaches-cache";
import {
  clearSessionCookie,
  getAuthenticatedThinkificUserId,
  loadMeResponse,
  resolveCoachByEmail,
  setSessionCookie,
} from "../lib/coach-session";

const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const coachAuthRoutes = new Hono();

coachAuthRoutes.post("/api/coach-auth/request", (c) =>
  withJsonBody(c, async (body) => {
    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }
    const email = parsedEmail.email;

    const limit = checkRateLimit(
      `auth:request:${getClientIp(c)}:${email}`,
      env.coachAuthRequestRateLimitMax,
      env.coachAuthRequestRateLimitWindowMs,
    );
    if (limit.limited) {
      return c.json(
        { error: "Too many code requests. Please try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    let debugCode: string | undefined;
    try {
      const resolved = await resolveCoachByEmail(email);
      const code = await createLoginCode(
        resolved.thinkificUserId,
        email,
        env.coachAuthCodeTtlMinutes,
      );
      await sendCoachLoginCode({ toEmail: email, code });
      if (env.coachAuthDebugExposeCode) debugCode = code;
    } catch (err) {
      console.error(
        `[coach-auth] request failed for ${email}: ${(err as Error).message}`,
      );
      // Swallowed to prevent account enumeration.
    }

    return c.json({
      ok: true,
      message: "If this email is eligible, a login code has been sent.",
      ...(debugCode ? { debugCode } : {}),
    });
  }),
);

coachAuthRoutes.post("/api/coach-auth/verify", (c) =>
  withJsonBody(c, async (body) => {
    const parsedEmail = readRequiredEmailField(body, "email");
    if (!parsedEmail.email) {
      return c.json({ error: parsedEmail.error ?? "email is required" }, 400);
    }
    const parsedCode = readRequiredCodeField(body, "code");
    if (!parsedCode.code) {
      return c.json({ error: parsedCode.error ?? "code is required" }, 400);
    }
    const email = parsedEmail.email;
    const code = parsedCode.code;

    const limit = checkRateLimit(
      `auth:verify:${getClientIp(c)}:${email}`,
      env.coachAuthVerifyRateLimitMax,
      env.coachAuthVerifyRateLimitWindowMs,
    );
    if (limit.limited) {
      return c.json(
        { error: "Too many verification attempts. Please try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    // An unknown email is an expected auth failure — return the same generic
    // 401 as a bad code so we don't leak which emails are eligible. Any other
    // error (DB down, etc.) must NOT be masked as 401; let it surface as a 500
    // via the app error handler so real incidents are diagnosable.
    let resolved: Awaited<ReturnType<typeof resolveCoachByEmail>>;
    try {
      resolved = await resolveCoachByEmail(email);
    } catch {
      return c.json({ error: "Invalid or expired code" }, 401);
    }

    const ok = await verifyAndConsumeLoginCode(
      resolved.thinkificUserId,
      email,
      code,
    );
    if (!ok) return c.json({ error: "Invalid or expired code" }, 401);

    const session = await createCoachSession(
      resolved.thinkificUserId,
      env.coachSessionTtlDays,
    );
    setSessionCookie(c, session.token, session.expiresAt);

    const me = await loadMeResponse(resolved.thinkificUserId);
    return c.json({ ok: true, me });
  }),
);

coachAuthRoutes.post("/api/coach-auth/logout", async (c) => {
  const token = getCookie(c, env.coachAuthCookieName);
  if (token) await deleteCoachSession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

coachAuthRoutes.get("/api/coach-auth/me", async (c) => {
  const thinkificUserId = await getAuthenticatedThinkificUserId(c);
  if (!thinkificUserId) return c.json({ error: "Unauthorized" }, 401);

  const me = await loadMeResponse(thinkificUserId);
  if (!me) return c.json({ error: "Coach not found" }, 404);

  return c.json(me);
});

coachAuthRoutes.put("/api/coach-auth/me", (c) =>
  withJsonBody(c, async (body) => {
    const thinkificUserId = await getAuthenticatedThinkificUserId(c);
    if (!thinkificUserId) return c.json({ error: "Unauthorized" }, 401);

    const parsed = parseCoachOverride(body);
    if (!parsed.override) {
      return c.json({ error: parsed.error ?? "Invalid override" }, 400);
    }

    const override = parsed.override;

    // Coaches set their location by city/state only — derive map coordinates
    // for them. If a client supplied explicit coords we respect those instead.
    if (
      override.lat == null &&
      override.lng == null &&
      (override.city || override.state)
    ) {
      const geo = await geocodeAddress(override.city ?? "", override.state ?? "");
      if (geo) {
        override.lat = geo.lat;
        override.lng = geo.lng;
      }
    }

    await upsertCoachOverride(thinkificUserId, override);
    invalidateCache();
    const me = await loadMeResponse(thinkificUserId);
    return c.json({ ok: true, me });
  }),
);

coachAuthRoutes.post("/api/coach-auth/me/avatar", async (c) => {
  const thinkificUserId = await getAuthenticatedThinkificUserId(c);
  if (!thinkificUserId) return c.json({ error: "Unauthorized" }, 401);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data" }, 400);
  }

  const avatar = formData.get("avatar");
  if (!(avatar instanceof File)) {
    return c.json({ error: "avatar file is required" }, 400);
  }

  if (avatar.size === 0) {
    return c.json({ error: "avatar file is empty" }, 400);
  }
  if (avatar.size > env.coachAvatarMaxBytes) {
    return c.json(
      {
        error: `avatar file is too large (max ${env.coachAvatarMaxBytes} bytes)`,
      },
      413,
    );
  }

  const extension = IMAGE_MIME_TO_EXT[avatar.type];
  if (!extension) {
    return c.json(
      {
        error:
          "Unsupported avatar type. Allowed: image/jpeg, image/png, image/webp, image/gif",
      },
      400,
    );
  }

  const filename = buildCoachMediaFilename(thinkificUserId, extension);
  await saveCoachMedia(filename, avatar, avatar.type);

  const existingOverride = (await getCoachOverride(thinkificUserId)) ?? {};
  const oldFilename =
    typeof existingOverride.avatarUrl === "string"
      ? resolveManagedCoachMediaFilename(existingOverride.avatarUrl)
      : null;

  const avatarUrl = buildCoachMediaUrl(c, filename);
  await upsertCoachOverride(thinkificUserId, {
    ...existingOverride,
    avatarUrl,
  });
  invalidateCache();

  if (oldFilename && oldFilename !== filename) {
    deleteCoachMedia(oldFilename).catch(() => {
      // Best-effort cleanup; it's safe to keep old media around.
    });
  }

  const me = await loadMeResponse(thinkificUserId);
  return c.json({ ok: true, avatarUrl, me });
});
