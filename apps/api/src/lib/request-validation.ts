import type { Context } from "hono";
import type { CoachOverride } from "./db/overrides";

export type JsonRecord = Record<string, unknown>;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonBody(c: Context): Promise<JsonRecord> {
  const body = await c.req.json<unknown>();
  if (!isJsonRecord(body)) {
    throw new Error("Invalid JSON body");
  }
  return body;
}

export function readOptionalStringField(
  body: JsonRecord,
  field: string,
): string | undefined {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
}

export function readRequiredEmailField(
  body: JsonRecord,
  field: string,
): { email?: string; error?: string } {
  const raw = readOptionalStringField(body, field);
  if (!raw || raw.trim() === "") {
    return { error: `${field} is required` };
  }
  const email = normalizeEmail(raw);
  const hasBasicEmailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!hasBasicEmailShape) {
    return { error: `${field} must be a valid email address` };
  }
  return { email };
}

export function readRequiredCodeField(
  body: JsonRecord,
  field: string,
): { code?: string; error?: string } {
  const raw = readOptionalStringField(body, field)?.trim();
  if (!raw) {
    return { error: `${field} is required` };
  }
  if (!/^\d{6}$/.test(raw)) {
    return { error: `${field} must be a 6-digit code` };
  }
  return { code: raw };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate and shape an incoming coach override body. Any field not present
 * (or explicitly null) is dropped — the caller writes a full row, so missing
 * fields become NULL in the DB.
 */
export function parseCoachOverride(body: JsonRecord): {
  override?: CoachOverride;
  error?: string;
} {
  const override: CoachOverride = {};

  if (body.bio !== undefined && body.bio !== null) {
    if (typeof body.bio !== "string") return { error: "bio must be a string" };
    override.bio = body.bio;
  }

  if (body.avatarUrl !== undefined && body.avatarUrl !== null) {
    if (typeof body.avatarUrl !== "string") {
      return { error: "avatarUrl must be a string" };
    }
    const trimmed = body.avatarUrl.trim();
    if (trimmed !== "") {
      try {
        const url = new URL(trimmed);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          return { error: "avatarUrl must be an http(s) URL" };
        }
      } catch {
        return { error: "avatarUrl must be a valid URL" };
      }
    }
    override.avatarUrl = body.avatarUrl;
  }

  if (body.city !== undefined && body.city !== null) {
    if (typeof body.city !== "string") {
      return { error: "city must be a string" };
    }
    override.city = body.city;
  }

  if (body.state !== undefined && body.state !== null) {
    if (typeof body.state !== "string") {
      return { error: "state must be a string" };
    }
    override.state = body.state;
  }

  if (body.lat !== undefined && body.lat !== null) {
    if (!isFiniteNumber(body.lat)) return { error: "lat must be a number" };
    if (body.lat < -90 || body.lat > 90) {
      return { error: "lat must be between -90 and 90" };
    }
    override.lat = body.lat;
  }

  if (body.lng !== undefined && body.lng !== null) {
    if (!isFiniteNumber(body.lng)) return { error: "lng must be a number" };
    if (body.lng < -180 || body.lng > 180) {
      return { error: "lng must be between -180 and 180" };
    }
    override.lng = body.lng;
  }

  return { override };
}
