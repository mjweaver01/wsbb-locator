import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Coach, CoachesPayload, CoachTier } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { TIER_LABELS, TIER_ORDER } from "@/lib/tiers";
import { deriveTier } from "@shared/tiers";

type AdminTier = "founder" | "master" | "instructor";
const ADMIN_TIER_OPTIONS: { value: AdminTier | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "founder", label: "Pathway Founder" },
  { value: "master", label: "Master Instructor" },
  { value: "instructor", label: "Instructor" },
];

const ADMIN_KEY_STORAGE = "wsbb_admin_key";

function readStoredAdminKey() {
  return localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
}

interface InviteResult {
  email: string;
  ok: boolean;
  thinkificUserId?: number;
  error?: string;
}

interface InviteResponse {
  ok: boolean;
  sent: number;
  total: number;
  results: InviteResult[];
  error?: string;
}

export function AdminInvitePage() {
  const storedKeyOnMount = useRef(readStoredAdminKey()).current;
  const [apiKey, setApiKey] = useState(storedKeyOnMount);
  const [isAuthenticated, setIsAuthenticated] = useState(!!storedKeyOnMount);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<CoachTier | "all">("all");
  const [loadingCoaches, setLoadingCoaches] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [tierBusy, setTierBusy] = useState<Set<number>>(new Set());

  const loadCoaches = useCallback(async (keyOverride?: string) => {
    const key = (keyOverride ?? apiKey).trim();
    if (!key) {
      setError("Enter the admin API key first.");
      return;
    }

    setLoadingCoaches(true);
    setError(null);
    setStatus(null);
    setResult(null);
    try {
      await apiFetch("/api/coaches/session", {
        headers: { "x-admin-api-key": key },
      });
      const data = await apiFetch<CoachesPayload>("/api/coaches");
      const list = (data.coaches ?? []).filter((c) => c.email);
      list.sort((a, b) => a.fullName.localeCompare(b.fullName));
      setCoaches(list);
      setSelected(new Set());
      setApiKey(key);
      localStorage.setItem(ADMIN_KEY_STORAGE, key);
      setIsAuthenticated(true);
      setStatus(`Loaded ${list.length} coaches.`);
    } catch (err) {
      localStorage.removeItem(ADMIN_KEY_STORAGE);
      setIsAuthenticated(false);
      setError((err as Error).message);
    } finally {
      setLoadingCoaches(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!storedKeyOnMount) return;
    void loadCoaches(storedKeyOnMount);
    // Restore session once on mount when a key is remembered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    localStorage.removeItem(ADMIN_KEY_STORAGE);
    setApiKey("");
    setIsAuthenticated(false);
    setCoaches([]);
    setSelected(new Set());
    setSearch("");
    setTierFilter("all");
    setResult(null);
    setStatus("Signed out.");
    setError(null);
  }

  const presentTiers = useMemo(
    () => TIER_ORDER.filter((t) => coaches.some((c) => c.tier === t)),
    [coaches],
  );

  const filtered = useMemo(() => {
    let result = coaches;
    if (tierFilter !== "all") result = result.filter((c) => c.tier === tierFilter);
    const q = search.trim().toLowerCase();
    if (q) result = result.filter(
      (c) => c.fullName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
    return result;
  }, [coaches, search, tierFilter]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.thinkificUserId);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setTierFilter("all");
    setSearch("");
  }

  async function sendInvites() {
    if (!apiKey.trim()) {
      setError("Enter the admin API key first.");
      return;
    }
    const emails = coaches
      .filter((c) => selected.has(c.thinkificUserId))
      .map((c) => c.email);
    if (emails.length === 0) {
      setError("Select at least one coach.");
      return;
    }

    setSending(true);
    setError(null);
    setStatus(null);
    setResult(null);
    try {
      const data = await apiFetch<InviteResponse>("/api/coaches/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-api-key": apiKey.trim(),
        },
        body: JSON.stringify({ emails }),
      });
      setResult(data);
      setStatus(`Sent ${data.sent} of ${data.total} invites.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function setAdminTier(coach: Coach, tier: AdminTier | "") {
    const key = apiKey.trim();
    if (!key) {
      setError("Enter the admin API key first.");
      return;
    }

    setTierBusy((prev) => new Set(prev).add(coach.thinkificUserId));
    setError(null);
    setStatus(null);
    try {
      await apiFetch(`/api/coaches/${coach.thinkificUserId}/tier`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-api-key": key,
        },
        body: JSON.stringify({ tier: tier || null }),
      });
      const nextTier: CoachTier =
        tier || deriveTier(coach.certifications);
      setCoaches((prev) =>
        prev.map((c) =>
          c.thinkificUserId === coach.thinkificUserId
            ? { ...c, tier: nextTier }
            : c,
        ),
      );
      const label = tier ? TIER_LABELS[tier].badge : "no admin tier";
      setStatus(`${coach.fullName} is now: ${label}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTierBusy((prev) => {
        const next = new Set(prev);
        next.delete(coach.thinkificUserId);
        return next;
      });
    }
  }

  const failedResults = result?.results.filter((r) => !r.ok) ?? [];

  return (
    <main className="coach-access-page">
      <header className="coach-access-page-header">
        <div className="coach-access-page-header__inner">
          <div className="admin-invite__header-top">
            <Link to="/" className="coach-access-page-header__back">
              ← Back to directory
            </Link>
            {isAuthenticated && (
              <button
                type="button"
                className="coach-access-page-header__pill admin-invite__logout"
                onClick={logout}
              >
                Sign out
              </button>
            )}
          </div>
          <p className="coach-access-page-header__eyebrow">WSBB Admin</p>
          <h1 className="coach-access-page-header__title">Invite Coaches</h1>
          <p className="coach-access-page-header__sub">
            Email certified coaches a code and a link to set up their public
            listing.
          </p>
        </div>
      </header>

      <section className="coach-access">
        <div className="coach-access__inner admin-invite">
          {!isAuthenticated && (
            <form
              className="coach-access__panel"
              onSubmit={(e) => {
                e.preventDefault();
                void loadCoaches();
              }}
            >
              <h3>Admin API key</h3>
              <label>
                Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="COACH_ADMIN_API_KEY"
                  autoComplete="off"
                />
              </label>
              <p className="coach-access__hint">
                Saved in this browser after a successful load.
              </p>
              <button type="submit" disabled={loadingCoaches}>
                {loadingCoaches ? "Loading…" : "Load coaches"}
              </button>
            </form>
          )}

          {isAuthenticated && loadingCoaches && coaches.length === 0 && (
            <p className="coach-access__status">Loading coaches…</p>
          )}

          {coaches.length > 0 && (
            <div className="coach-access__panel admin-invite__panel">
              <div className="admin-invite__head">
                <h3>Recipients</h3>
                <span className="admin-invite__count">
                  {selected.size} of {coaches.length} selected
                </span>
              </div>

              <div className="admin-invite__controls">
                <div className="admin-invite__bulk">
                  <button
                    type="button"
                    className="coach-access__ghost"
                    onClick={selectAllFiltered}
                  >
                    Select all{search || tierFilter !== "all" ? " shown" : ""}
                  </button>
                  <button
                    type="button"
                    className="coach-access__ghost"
                    onClick={clearSelection}
                    disabled={selected.size === 0 && tierFilter === "all" && !search}
                  >
                    Clear
                  </button>
                </div>
                <select
                  className="admin-invite__tier-select admin-invite__tier-filter-select"
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value as CoachTier | "all")}
                >
                  <option value="all">All tiers</option>
                  {presentTiers.map((t) => (
                    <option key={t} value={t}>{TIER_LABELS[t].section}</option>
                  ))}
                </select>
                <input
                  className="admin-invite__search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or email…"
                />
              </div>

              <ul className="admin-invite__list">
                {filtered.map((coach) => {
                  const checked = selected.has(coach.thinkificUserId);
                  const busy = tierBusy.has(coach.thinkificUserId);
                  const adminTier = (["founder", "master", "instructor"] as AdminTier[]).includes(
                    coach.tier as AdminTier,
                  )
                    ? (coach.tier as AdminTier)
                    : "";
                  return (
                    <li key={coach.thinkificUserId} className="admin-invite__row">
                      <label
                        className={`admin-invite__item${checked ? " admin-invite__item--checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(coach.thinkificUserId)}
                        />
                        <span className="admin-invite__item-name">
                          {coach.fullName}
                        </span>
                        <span className="admin-invite__item-email">
                          {coach.email}
                        </span>
                        <span
                          className={`admin-invite__tier admin-invite__tier--${coach.tier}`}
                        >
                          {TIER_LABELS[coach.tier].short}
                        </span>
                      </label>
                      <select
                        className="admin-invite__tier-select"
                        value={adminTier}
                        disabled={busy}
                        onChange={(e) =>
                          void setAdminTier(coach, e.target.value as AdminTier | "")
                        }
                        title="Grant or revoke an admin-bestowed tier"
                      >
                        {ADMIN_TIER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {busy ? "…" : opt.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="admin-invite__empty">
                    No coaches match “{search}”.
                  </li>
                )}
              </ul>

              <div className="admin-invite__footer">
                <span className="admin-invite__shown">
                  Showing {filtered.length} of {coaches.length}
                </span>
                <button
                  type="button"
                  className="admin-invite__send"
                  onClick={sendInvites}
                  disabled={sending || selected.size === 0}
                >
                  {sending
                    ? "Sending…"
                    : `Send ${selected.size} invite${selected.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}

          {result && failedResults.length > 0 && (
            <div className="coach-access__panel admin-invite__panel">
              <h3>Failed ({failedResults.length})</h3>
              <ul className="admin-invite__results">
                {failedResults.map((r) => (
                  <li key={r.email}>
                    <strong>{r.email}</strong> — {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status && <p className="coach-access__status">{status}</p>}
          {error && <p className="coach-access__error">{error}</p>}
        </div>
      </section>
    </main>
  );
}
