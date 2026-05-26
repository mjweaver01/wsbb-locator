import type { Context } from "hono";

export const COACH_MEDIA_ROUTE_PREFIX = "/api/coach-media/";

// Allowed filename charset for media routes — keep this in lockstep with the
// shape produced by buildCoachMediaFilename() in coach-media.ts.
export const SAFE_MEDIA_FILENAME = /^[A-Za-z0-9._-]+$/;

/**
 * Build the absolute URL the avatar will be served from. Uses the request's
 * own URL as the base so cross-origin embeds resolve correctly.
 */
export function buildCoachMediaUrl(c: Context, filename: string): string {
  return new URL(
    `${COACH_MEDIA_ROUTE_PREFIX}${filename}`,
    c.req.url,
  ).toString();
}

/**
 * Given a stored avatarUrl, return the underlying media filename if it
 * points at our /api/coach-media/ route. Returns null for any other URL
 * (external Thinkific avatars, user-supplied https URLs, malformed values).
 *
 * Used during avatar replacement to find the previous file for cleanup.
 */
export function resolveManagedCoachMediaFilename(
  avatarUrl: string,
): string | null {
  try {
    const parsed = new URL(avatarUrl);
    if (!parsed.pathname.startsWith(COACH_MEDIA_ROUTE_PREFIX)) return null;
    const candidate = parsed.pathname.slice(COACH_MEDIA_ROUTE_PREFIX.length);
    return SAFE_MEDIA_FILENAME.test(candidate) ? candidate : null;
  } catch {
    if (!avatarUrl.startsWith(COACH_MEDIA_ROUTE_PREFIX)) return null;
    const candidate = avatarUrl.slice(COACH_MEDIA_ROUTE_PREFIX.length);
    return SAFE_MEDIA_FILENAME.test(candidate) ? candidate : null;
  }
}
