import { extname, resolve } from "path";

const SAFE_PATH = /^(?!.*\.\.)[A-Za-z0-9._/-]*$/;

// Vite emits content-hashed filenames into /assets, so they're safe to cache
// for a year. index.html (and any extensionless SPA-routed path) must never
// be cached or stale clients won't pick up new asset hashes.
const IMMUTABLE_PREFIX = "/assets/";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const HTML_CACHE = "no-cache";

function cacheControlFor(pathname: string, isHtmlFallback: boolean): string {
  if (isHtmlFallback) return HTML_CACHE;
  if (pathname.startsWith(IMMUTABLE_PREFIX)) return IMMUTABLE_CACHE;
  if (pathname === "/" || pathname.endsWith(".html")) return HTML_CACHE;
  return "public, max-age=3600";
}

/**
 * Serve a built SPA from `rootDir`. Returns null when nothing matches so the
 * caller can fall through to API routes / 404.
 *
 * Behavior:
 * - `/` → index.html (no-cache)
 * - paths with file extensions → served verbatim if present (long-cache under /assets/)
 * - paths without extensions → SPA fallback to index.html (no-cache)
 */
export async function serveStaticSpa(
  rootDir: string,
  pathname: string,
): Promise<Response | null> {
  if (!SAFE_PATH.test(pathname)) return null;

  const ext = extname(pathname);
  const candidate =
    pathname === "/"
      ? resolve(rootDir, "index.html")
      : resolve(rootDir, "." + pathname);

  const file = Bun.file(candidate);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "Cache-Control": cacheControlFor(pathname, false) },
    });
  }

  if (ext === "") {
    const indexFile = Bun.file(resolve(rootDir, "index.html"));
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Cache-Control": cacheControlFor(pathname, true) },
      });
    }
  }

  return null;
}
