import { describe, expect, test } from "bun:test";
import { parseCoachOverride } from "./request-validation";

describe("parseCoachOverride", () => {
  test("empty body yields an empty override with no error", () => {
    const result = parseCoachOverride({});
    expect(result.error).toBeUndefined();
    expect(result.override).toEqual({});
  });

  test("trims string fields", () => {
    const result = parseCoachOverride({ bio: "  hello  ", city: " Columbus " });
    expect(result.override).toEqual({ bio: "hello", city: "Columbus" });
  });

  test("null fields are dropped (treated as not supplied)", () => {
    const result = parseCoachOverride({ bio: null, city: "Columbus" });
    expect(result.override).toEqual({ city: "Columbus" });
  });

  test("unknown keys (identity columns) are stripped", () => {
    const result = parseCoachOverride({
      bio: "hi",
      email: "attacker@example.com",
      tier: "master",
      thinkificUserId: 1,
    });
    expect(result.override).toEqual({ bio: "hi" });
  });

  test("rejects non-string bio", () => {
    const result = parseCoachOverride({ bio: 42 });
    expect(result.override).toBeUndefined();
    expect(result.error).toBe("bio must be a string");
  });

  test("accepts a valid https avatar URL", () => {
    const result = parseCoachOverride({
      avatarUrl: "https://cdn.example.com/a.png",
    });
    expect(result.override).toEqual({
      avatarUrl: "https://cdn.example.com/a.png",
    });
  });

  test("keeps an empty avatarUrl (clears the avatar)", () => {
    const result = parseCoachOverride({ avatarUrl: "" });
    expect(result.override).toEqual({ avatarUrl: "" });
  });

  test("rejects a non-http(s) avatar URL", () => {
    const result = parseCoachOverride({ avatarUrl: "ftp://example.com/a.png" });
    expect(result.error).toBe("avatarUrl must be an http(s) URL");
  });

  test("rejects a malformed avatar URL", () => {
    const result = parseCoachOverride({ avatarUrl: "not a url" });
    expect(result.error).toBe("avatarUrl must be an http(s) URL");
  });

  test("accepts in-range coordinates", () => {
    const result = parseCoachOverride({ lat: 39.96, lng: -83 });
    expect(result.override).toEqual({ lat: 39.96, lng: -83 });
  });

  test("rejects a non-numeric latitude", () => {
    const result = parseCoachOverride({ lat: "39.96" });
    expect(result.error).toBe("lat must be a number");
  });

  test("rejects out-of-range latitude", () => {
    const result = parseCoachOverride({ lat: 200 });
    expect(result.error).toBe("lat must be between -90 and 90");
  });

  test("rejects out-of-range longitude", () => {
    const result = parseCoachOverride({ lng: -1000 });
    expect(result.error).toBe("lng must be between -180 and 180");
  });
});
