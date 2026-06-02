import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Coach, CoachesPayload } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { TIER_LABELS } from "@/lib/tiers";

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
  const [loadingCoaches, setLoadingCoaches] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResponse | null>(null);

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
    setResult(null);
    setStatus("Signed out.");
    setError(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return coaches;
    return coaches.filter(
      (c) =>
        c.fullName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q),
    );
  }, [coaches, search]);

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
                    Select all{search ? " shown" : ""}
                  </button>
                  <button
                    type="button"
                    className="coach-access__ghost"
                    onClick={clearSelection}
                    disabled={selected.size === 0}
                  >
                    Clear
                  </button>
                </div>
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
                  return (
                    <li key={coach.thinkificUserId}>
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
