import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "./env";
import { getCoachSession } from "./db/auth";
import { listCoachEmailLinks } from "./db/email-links";
import { findThinkificUserIdByLinkedEmail } from "./db/email-links";
import { getCoaches } from "./coaches-cache";
import type { Coach } from "./thinkific";

export interface MeResponse {
  coach: Coach;
  emailLinks: Awaited<ReturnType<typeof listCoachEmailLinks>>;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Session cookie helpers
// ---------------------------------------------------------------------------

export function setSessionCookie(
  c: Context,
  token: string,
  expiresAt: string,
): void {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  setCookie(c, env.coachAuthCookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: maxAgeSeconds,
    secure: env.coachAuthCookieSecure,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, env.coachAuthCookieName, {
    path: "/",
    secure: env.coachAuthCookieSecure,
  });
}

export async function getAuthenticatedThinkificUserId(
  c: Context,
): Promise<number | null> {
  const token = getCookie(c, env.coachAuthCookieName);
  if (!token) return null;
  return (await getCoachSession(token))?.thinkificUserId ?? null;
}

/**
 * Build the canonical "me" payload for an authenticated coach. Centralized so
 * verify / PUT /me / POST avatar can all return the same shape and the FE
 * doesn't need to follow every mutation with a separate GET /me.
 */
export async function loadMeResponse(
  thinkificUserId: number,
): Promise<MeResponse | null> {
  const { data } = await getCoaches();
  const coach = data.coaches.find(
    (item) => item.thinkificUserId === thinkificUserId,
  );
  if (!coach) return null;
  return { coach, emailLinks: await listCoachEmailLinks(thinkificUserId) };
}

/**
 * Find a coach by their Thinkific primary email OR by any alias stored in
 * coach_email_links. Throws when no match exists.
 */
export async function resolveCoachByEmail(email: string): Promise<{
  thinkificUserId: number;
  source: "thinkific-email" | "linked-email";
}> {
  const normalizedEmail = normalizeEmail(email);
  const { data } = await getCoaches();

  const direct = data.coaches.find(
    (coach) => normalizeEmail(coach.email) === normalizedEmail,
  );
  if (direct) {
    return {
      thinkificUserId: direct.thinkificUserId,
      source: "thinkific-email",
    };
  }

  const linkedId = await findThinkificUserIdByLinkedEmail(normalizedEmail);
  if (linkedId) {
    return { thinkificUserId: linkedId, source: "linked-email" };
  }

  throw new Error("Coach not found");
}
