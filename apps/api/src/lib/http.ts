import type { Context } from "hono";
import { readJsonBody, type JsonRecord } from "./request-validation";

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

export function getClientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return c.req.header("x-real-ip") ?? "unknown";
}
