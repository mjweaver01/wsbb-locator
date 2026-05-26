import type { Context } from "hono";
import { readJsonBody, type JsonRecord } from "./request-validation";

// Read at request time, not at module load, so operators can toggle without
// restarting and tests can flip the value between cases.
function isProxyTrusted(): boolean {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === undefined) {
    return process.env.NODE_ENV === "production";
  }
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/**
 * Read a JSON body and pass it to the handler. Returns a 400 if the body
 * isn't a JSON object. Lets each route stop re-implementing the same try/catch.
 */
export async function withJsonBody(
  c: Context,
  handler: (body: JsonRecord) => Response | Promise<Response>,
): Promise<Response> {
  let body: JsonRecord;
  try {
    body = await readJsonBody(c);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  return handler(body);
}

/** Pull an integer route param. Returns a 400 Response when invalid. */
export function parseIntParam(c: Context, name: string): number | Response {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value)) {
    return c.json({ error: `${name} must be an integer` }, 400);
  }
  return value;
}

/**
 * Best-effort client IP for rate-limit keys. We only honor x-forwarded-for /
 * x-real-ip when TRUST_PROXY is set, otherwise those headers are spoofable
 * by any external client and would let an attacker bypass rate limits by
 * rotating the header value.
 */
export function getClientIp(c: Context): string {
  if (isProxyTrusted()) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || "unknown";
    }
    const real = c.req.header("x-real-ip");
    if (real) return real;
  }
  return "unknown";
}
