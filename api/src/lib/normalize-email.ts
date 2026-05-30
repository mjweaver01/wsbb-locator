/**
 * Canonical email normalization used everywhere an email is stored or compared
 * (login codes, sessions, email links, override resolution). Auth correctness
 * depends on every call site agreeing, so this lives in one leaf module.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
