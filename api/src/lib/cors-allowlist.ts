/**
 * Allowlist match for CORS origins. An entry is either an exact origin
 * (e.g. `https://westside-barbell.com`) or a subdomain wildcard with `*.` in
 * the host position (e.g. `https://*.westside-barbell.com`) which matches any
 * single-or-multi-label subdomain — but NOT the apex. List both when you
 * want to allow apex + subdomains.
 */
export function isOriginAllowed(
  origin: string,
  allowlist: readonly string[],
): boolean {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  for (const entry of allowlist) {
    if (entry === origin) return true;

    const wildcardIdx = entry.indexOf("://*.");
    if (wildcardIdx === -1) continue;

    const protocol = entry.slice(0, wildcardIdx + 1);
    const suffix = entry.slice(wildcardIdx + 4); // ".example.com"
    if (parsedOrigin.protocol !== protocol) continue;
    if (
      parsedOrigin.host.endsWith(suffix) &&
      parsedOrigin.host !== suffix.slice(1)
    ) {
      return true;
    }
  }
  return false;
}
