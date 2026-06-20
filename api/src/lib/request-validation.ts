import { z } from "zod";
import type { Context } from "hono";
import type { CoachOverride } from "./db/overrides";
import { normalizeEmail } from "./normalize-email";

export type JsonRecord = Record<string, unknown>;

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

// ---------------------------------------------------------------------------
// Coach override boundary schema
// ---------------------------------------------------------------------------

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// `null` is treated as "field not supplied" so it drops out of the result —
// the override is written as a full row, so an absent field becomes NULL.
const nullToUndefined = (value: unknown) => (value === null ? undefined : value);

const trimmedString = (field: string) =>
  z.preprocess(
    nullToUndefined,
    z.string({ error: `${field} must be a string` }).trim().optional(),
  );

// Name fields differ from bio/city: an empty value means "revert to the
// identity (Thinkific/manual) name", so it's dropped rather than written as a
// blank override. A provided name is capped to keep the directory tidy.
const nameField = (field: string) =>
  z.preprocess(
    (value) => {
      if (value === null) return undefined;
      if (typeof value === "string" && value.trim() === "") return undefined;
      return value;
    },
    z
      .string({ error: `${field} must be a string` })
      .trim()
      .max(80, `${field} must be 80 characters or fewer`)
      .optional(),
  );

const avatarUrlField = z.preprocess(
  nullToUndefined,
  z
    .string({ error: "avatarUrl must be a string" })
    .trim()
    // Empty string clears the avatar; any non-empty value must be a real URL.
    .refine((s) => s === "" || isHttpUrl(s), "avatarUrl must be an http(s) URL")
    .optional(),
);

const latitudeField = z.preprocess(
  nullToUndefined,
  z
    .number({ error: "lat must be a number" })
    .refine(Number.isFinite, "lat must be a number")
    .min(-90, "lat must be between -90 and 90")
    .max(90, "lat must be between -90 and 90")
    .optional(),
);

const longitudeField = z.preprocess(
  nullToUndefined,
  z
    .number({ error: "lng must be a number" })
    .refine(Number.isFinite, "lng must be a number")
    .min(-180, "lng must be between -180 and 180")
    .max(180, "lng must be between -180 and 180")
    .optional(),
);

// Unknown keys (e.g. identity columns like email/tier) are stripped by
// default, so they can never sneak into an override.
const coachOverrideSchema = z.object({
  firstName: nameField("firstName"),
  lastName: nameField("lastName"),
  bio: trimmedString("bio"),
  avatarUrl: avatarUrlField,
  city: trimmedString("city"),
  state: trimmedString("state"),
  lat: latitudeField,
  lng: longitudeField,
});

/**
 * Validate and shape an incoming coach override body. Any field not present
 * (or explicitly null) is dropped — the caller writes a full row, so missing
 * fields become NULL in the DB.
 */
export function parseCoachOverride(body: JsonRecord): {
  override?: CoachOverride;
  error?: string;
} {
  const result = coachOverrideSchema.safeParse(body);
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? "Invalid override" };
  }

  const override: CoachOverride = {};
  for (const [key, value] of Object.entries(result.data)) {
    if (value !== undefined) {
      (override as Record<string, unknown>)[key] = value;
    }
  }
  return { override };
}
