import type { Context } from "hono";
import type { CoachOverride } from "./overrides-db";

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

export function parseCoachOverridePatch(body: JsonRecord): {
  patch?: CoachOverride;
  error?: string;
} {
  const patch: CoachOverride = {};
  let hasKnownField = false;

  const bio = body.bio;
  if (bio !== undefined) {
    hasKnownField = true;
    if (typeof bio !== "string") return { error: "bio must be a string" };
    patch.bio = bio;
  }

  const avatarUrl = body.avatarUrl;
  if (avatarUrl !== undefined) {
    hasKnownField = true;
    if (typeof avatarUrl !== "string") {
      return { error: "avatarUrl must be a string" };
    }
    const trimmed = avatarUrl.trim();
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
    patch.avatarUrl = avatarUrl;
  }

  const city = body.city;
  if (city !== undefined) {
    hasKnownField = true;
    if (typeof city !== "string") return { error: "city must be a string" };
    patch.city = city;
  }

  const state = body.state;
  if (state !== undefined) {
    hasKnownField = true;
    if (typeof state !== "string") return { error: "state must be a string" };
    patch.state = state;
  }

  const lat = body.lat;
  if (lat !== undefined) {
    hasKnownField = true;
    if (!isFiniteNumber(lat)) return { error: "lat must be a number" };
    if (lat < -90 || lat > 90) {
      return { error: "lat must be between -90 and 90" };
    }
    patch.lat = lat;
  }

  const lng = body.lng;
  if (lng !== undefined) {
    hasKnownField = true;
    if (!isFiniteNumber(lng)) return { error: "lng must be a number" };
    if (lng < -180 || lng > 180) {
      return { error: "lng must be between -180 and 180" };
    }
    patch.lng = lng;
  }

  if (!hasKnownField) {
    return { error: "No valid override fields provided" };
  }

  return { patch };
}
