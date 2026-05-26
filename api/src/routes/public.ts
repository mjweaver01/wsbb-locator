import { Hono } from "hono";
import { getCacheStatus, getCoaches } from "../lib/coaches-cache";
import { readCoachMedia } from "../lib/coach-media";
import { SAFE_MEDIA_FILENAME } from "../lib/coach-media-url";

export const publicRoutes = new Hono();

publicRoutes.get("/api/health", (c) => c.json({ ok: true, ...getCacheStatus() }));

publicRoutes.get("/api/coaches", async (c) => {
  try {
    const { data, source } = await getCoaches();
    return c.json(data, 200, { "X-Data-Source": source });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

publicRoutes.get("/api/coach-media/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!SAFE_MEDIA_FILENAME.test(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }
  const media = await readCoachMedia(filename);
  if (!media) {
    return c.json({ error: "Not found" }, 404);
  }
  return media;
});
