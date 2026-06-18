import { describe, expect, test } from "bun:test";
import type { CoachesPayload } from "@shared/coach";
import { mergeCoachOverrides } from "./coaches-cache";
import type { CoachOverride } from "./db/overrides";

function makePayload(): CoachesPayload {
  return {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    subdomain: "westside-barbell",
    totalCoaches: 2,
    tierBreakdown: { founder: 0, master: 1, instructor: 0, certified: 1, candidate: 0 },
    coaches: [
      {
        thinkificUserId: 1,
        email: "master@example.com",
        firstName: "Master",
        lastName: "Coach",
        fullName: "Master Coach",
        avatarUrl: null,
        bio: "thinkific bio",
        company: "Westside",
        tier: "master",
        certifications: [],
        city: "Original City",
      },
      {
        thinkificUserId: 2,
        email: "certified@example.com",
        firstName: "Certified",
        lastName: "Coach",
        fullName: "Certified Coach",
        avatarUrl: null,
        bio: null,
        company: null,
        tier: "certified",
        certifications: [],
      },
    ],
  };
}

describe("mergeCoachOverrides", () => {
  test("applies safe override fields and recomputes totals", async () => {
    const overrides: Record<string, CoachOverride> = {
      "1": {
        bio: "override bio",
        city: "Columbus",
        state: "OH",
        lat: 39.96,
        lng: -83,
      },
    };

    const merged = await mergeCoachOverrides(makePayload(), overrides);
    const coach = merged.coaches.find((c) => c.thinkificUserId === 1)!;

    expect(coach.bio).toBe("override bio");
    expect(coach.city).toBe("Columbus");
    expect(coach.state).toBe("OH");
    expect(coach.lat).toBe(39.96);
    expect(coach.lng).toBe(-83);

    // Identity columns always come from Thinkific, never the override.
    expect(coach.email).toBe("master@example.com");
    expect(coach.fullName).toBe("Master Coach");
    expect(coach.tier).toBe("master");

    expect(merged.totalCoaches).toBe(2);
    expect(merged.tierBreakdown).toEqual({
      founder: 0,
      master: 1,
      instructor: 0,
      certified: 1,
      candidate: 0,
    });
  });

  test("promotes a coach to master when isMaster is granted", async () => {
    const overrides: Record<string, CoachOverride> = {
      "2": { isMaster: true },
    };

    const merged = await mergeCoachOverrides(makePayload(), overrides);
    const coach = merged.coaches.find((c) => c.thinkificUserId === 2)!;

    expect(coach.tier).toBe("master");
    expect(merged.tierBreakdown).toEqual({
      founder: 0,
      master: 2,
      instructor: 0,
      certified: 0,
      candidate: 0,
    });
  });

  test("ignores non-safe keys that somehow appear in an override", async () => {
    const overrides = {
      "1": {
        bio: "override bio",
        email: "attacker@example.com",
        tier: "certified",
      } as unknown as CoachOverride,
    };

    const merged = await mergeCoachOverrides(makePayload(), overrides);
    const coach = merged.coaches.find((c) => c.thinkificUserId === 1)!;

    expect(coach.bio).toBe("override bio");
    expect(coach.email).toBe("master@example.com");
    expect(coach.tier).toBe("master");
  });

  test("leaves coaches without an override untouched", async () => {
    const merged = await mergeCoachOverrides(makePayload(), {});
    const coach = merged.coaches.find((c) => c.thinkificUserId === 2)!;

    expect(coach.bio).toBeNull();
    expect(coach.city).toBeUndefined();
    expect(coach.tier).toBe("certified");
  });
});
