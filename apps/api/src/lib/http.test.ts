import { beforeEach, describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { getClientIp, parseIntParam, withJsonBody } from "./http";

beforeEach(() => {
  // getClientIp consults TRUST_PROXY at request time.
  process.env.TRUST_PROXY = "true";
});

function makeContext({
  body,
  paramValue,
  headers,
}: {
  body?: unknown;
  paramValue?: string;
  headers?: Record<string, string | undefined>;
} = {}): Context {
  return {
    req: {
      json: async () => body,
      param: () => paramValue ?? "",
      header: (name: string) => headers?.[name.toLowerCase()],
    },
    json: (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status }),
  } as unknown as Context;
}

describe("withJsonBody", () => {
  test("passes a parsed object body to the handler", async () => {
    const response = await withJsonBody(
      makeContext({ body: { email: "coach@example.com" } }),
      (parsedBody) => new Response(JSON.stringify(parsedBody), { status: 201 }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ email: "coach@example.com" });
  });

  test("returns 400 when body is not a JSON object", async () => {
    const response = await withJsonBody(makeContext({ body: ["bad"] }), () => {
      throw new Error("handler should not run");
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
  });
});

describe("parseIntParam", () => {
  test("returns parsed integer params", () => {
    const parsed = parseIntParam(makeContext({ paramValue: "42" }), "coachId");
    expect(parsed).toBe(42);
  });

  test("returns 400 response for non-integer params", async () => {
    const parsed = parseIntParam(makeContext({ paramValue: "abc" }), "coachId");

    expect(parsed).toBeInstanceOf(Response);
    const response = parsed as Response;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "coachId must be an integer",
    });
  });
});

describe("getClientIp", () => {
  test("prefers x-forwarded-for and strips extra values", () => {
    const ip = getClientIp(
      makeContext({
        headers: {
          "x-forwarded-for": "198.51.100.23, 203.0.113.10",
          "x-real-ip": "203.0.113.10",
        },
      }),
    );
    expect(ip).toBe("198.51.100.23");
  });

  test("falls back to x-real-ip and then unknown", () => {
    expect(
      getClientIp(makeContext({ headers: { "x-real-ip": "203.0.113.44" } })),
    ).toBe("203.0.113.44");
    expect(getClientIp(makeContext())).toBe("unknown");
  });

  test("ignores forwarded headers when proxy trust is disabled", () => {
    process.env.TRUST_PROXY = "false";
    expect(
      getClientIp(
        makeContext({
          headers: {
            "x-forwarded-for": "198.51.100.23",
            "x-real-ip": "203.0.113.10",
          },
        }),
      ),
    ).toBe("unknown");
  });
});
