import { FormEvent, useEffect, useState } from "react";
import type { RawCoach } from "@/lib/types";

interface CoachEmailLink {
  email: string;
  source: string;
  createdAt: string;
}

interface MeResponse {
  coach: RawCoach;
  emailLinks: CoachEmailLink[];
}

interface CoachProfileAccessProps {
  apiBase: string;
  showIntro?: boolean;
}

function apiUrl(apiBase: string, path: string) {
  return `${apiBase}${path}`;
}

export function CoachProfileAccess({
  apiBase,
  showIntro = true,
}: CoachProfileAccessProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  useEffect(() => {
    fetch(apiUrl(apiBase, "/api/coach-auth/me"), { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok)
          throw new Error(`Failed to load profile (${response.status})`);
        return (await response.json()) as MeResponse;
      })
      .then((data) => {
        if (!data) return;
        hydrateProfile(data);
      })
      .catch(() => {
        // Silent on initial load: unauthenticated is an expected state.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  function hydrateProfile(data: MeResponse) {
    setMe(data);
    setBio(data.coach.bio ?? "");
    setAvatarUrl(data.coach.avatarUrl ?? "");
    setCity(data.coach.city ?? "");
    setState(data.coach.state ?? "");
    setLat(data.coach.lat !== undefined ? String(data.coach.lat) : "");
    setLng(data.coach.lng !== undefined ? String(data.coach.lng) : "");
  }

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setRequestStatus(null);

    try {
      const response = await fetch(apiUrl(apiBase, "/api/coach-auth/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        debugCode?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not request code");
      setRequestStatus(
        data.debugCode
          ? `${data.message} (debug code: ${data.debugCode})`
          : (data.message ?? "Code sent"),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(apiUrl(apiBase, "/api/coach-auth/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as { error?: string } & MeResponse;
      if (!response.ok) throw new Error(data.error ?? "Could not verify code");

      const meResponse = await fetch(apiUrl(apiBase, "/api/coach-auth/me"), {
        credentials: "include",
      });
      if (!meResponse.ok)
        throw new Error("Verified, but failed to load profile");
      const meData = (await meResponse.json()) as MeResponse;
      hydrateProfile(meData);
      setRequestStatus("Email verified. You can now edit your listing.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    setError(null);
    setRequestStatus(null);

    const parsedLat = lat.trim() === "" ? undefined : Number(lat);
    const parsedLng = lng.trim() === "" ? undefined : Number(lng);

    if (
      (parsedLat !== undefined && Number.isNaN(parsedLat)) ||
      (parsedLng !== undefined && Number.isNaN(parsedLng))
    ) {
      setError("Latitude and longitude must be valid numbers.");
      setProfileSaving(false);
      return;
    }

    try {
      const response = await fetch(apiUrl(apiBase, "/api/coach-auth/me"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio,
          avatarUrl,
          city,
          state,
          lat: parsedLat,
          lng: parsedLng,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save profile");

      const meResponse = await fetch(apiUrl(apiBase, "/api/coach-auth/me"), {
        credentials: "include",
      });
      if (!meResponse.ok)
        throw new Error("Saved, but failed to reload profile");
      const meData = (await meResponse.json()) as MeResponse;
      hydrateProfile(meData);
      setRequestStatus("Profile updated.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function logout() {
    setLoading(true);
    setError(null);
    try {
      await fetch(apiUrl(apiBase, "/api/coach-auth/logout"), {
        method: "POST",
        credentials: "include",
      });
      setMe(null);
      setCode("");
      setRequestStatus("Signed out.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="coach-access">
      <div className="coach-access__inner">
        {showIntro && (
          <>
            <p className="coach-access__eyebrow">Coach Profile Access</p>
            <h2 className="coach-access__heading">Update Your Listing</h2>
            <p className="coach-access__sub">
              Use your email to request a one-time code and edit your public
              coach profile.
            </p>
          </>
        )}

        {!me ? (
          <div className="coach-access__auth-grid">
            <form className="coach-access__panel" onSubmit={requestCode}>
              <h3>1. Request Code</h3>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <button type="submit" disabled={loading}>
                Send code
              </button>
            </form>

            <form className="coach-access__panel" onSubmit={verifyCode}>
              <h3>2. Verify Code</h3>
              <label>
                6-digit code
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  placeholder="123456"
                  required
                />
              </label>
              <button type="submit" disabled={loading || email.trim() === ""}>
                Verify
              </button>
            </form>
          </div>
        ) : (
          <form
            className="coach-access__panel coach-access__panel--full"
            onSubmit={saveProfile}
          >
            <h3>Verified profile: {me.coach.fullName}</h3>
            <p className="coach-access__meta">
              Thinkific email: <strong>{me.coach.email}</strong>
            </p>

            <label>
              Bio
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
              />
            </label>
            <label>
              Avatar URL
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
            </label>
            <div className="coach-access__row">
              <label>
                City
                <input value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label>
                State
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                />
              </label>
            </div>
            <div className="coach-access__row">
              <label>
                Latitude
                <input value={lat} onChange={(e) => setLat(e.target.value)} />
              </label>
              <label>
                Longitude
                <input value={lng} onChange={(e) => setLng(e.target.value)} />
              </label>
            </div>

            {me.emailLinks.length > 0 && (
              <div className="coach-access__links">
                <p>Linked emails</p>
                <ul>
                  {me.emailLinks.map((link) => (
                    <li key={link.email}>
                      {link.email} <span>({link.source})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="coach-access__actions">
              <button type="submit" disabled={profileSaving}>
                {profileSaving ? "Saving…" : "Save profile"}
              </button>
              <button
                type="button"
                className="coach-access__ghost"
                onClick={logout}
                disabled={loading}
              >
                Sign out
              </button>
            </div>
          </form>
        )}

        {requestStatus && (
          <p className="coach-access__status">{requestStatus}</p>
        )}
        {error && <p className="coach-access__error">{error}</p>}
      </div>
    </section>
  );
}
