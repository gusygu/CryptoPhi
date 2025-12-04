// src/app/profile/page.tsx
"use client";

  import { useEffect, useState } from "react";
  import type { FormEvent } from "react";

type DensityMode = "normal" | "compact";

interface UserProfile {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  invitedBy: string | null;
  inviteSource: string | null;
  locale: string;
  timezone: string;
}

interface UserSettings {
  userId: string;
  densityMode: DensityMode;
  isAdvanced: boolean;
  theme: string;
  defaultMatrixWindow: string;
  favoriteSymbols: string[];
  createdAt: string;
  updatedAt: string;
}

interface FullProfile {
  profile: UserProfile;
  settings: UserSettings;
}

interface ApiProfileResponse {
  ok: boolean;
  profile?: FullProfile;
  error?: string;
}

interface ApiPatchResponse {
  ok: boolean;
  settings?: UserSettings;
  error?: string;
}

// ---- Invite section types ----

type InviteInfo = {
  email: string;
  createdAt: string;
  uses: number;
  maxUses: number;
  consumed: boolean;
};

type InvitedUserInfo = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
};

// ---- Invite section component ----

function InviteSection() {
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [invitedUser, setInvitedUser] = useState<InvitedUserInfo | null>(
    null
  );

  const [emailInput, setEmailInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInvite() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/user-invite", { cache: "no-store" });
        const body = await res.json().catch(() => null);

        if (!res.ok || !body) {
          throw new Error(body?.error || "Failed to load invite");
        }

        if (cancelled) return;

        setInvite(body.invite ?? null);
        setInvitedUser(body.invitedUser ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message ?? e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInvite();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const email = emailInput.trim();
    if (!email) {
      setError("Please enter an email.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/user-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || "Failed to create invite.");
      }

      setInvite({
        email: body.invite.email,
        createdAt: new Date().toISOString(),
        uses: 0,
        maxUses: 1,
        consumed: false,
      });
      setSuccess("Invite sent successfully.");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border border-zinc-800 rounded-lg p-3 bg-black/30 flex flex-col gap-2 text-xs">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        Invitation
      </h2>

      {loading && (
        <p className="text-[11px] opacity-70">Loading invite status…</p>
      )}

      {!loading && !invite && (
        <form onSubmit={handleCreateInvite} className="space-y-2">
          <p className="opacity-80">
            You can invite <span className="font-semibold">one</span> person to
            CryptoPhi. Once you send it, you can&apos;t reassign it.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="friend@example.com"
              className="flex-1 rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-600/40 text-xs font-medium text-emerald-50 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send invite"}
            </button>
          </div>
          <p className="text-[10px] opacity-70">
            We&apos;ll send a one-time link tied to this email.
          </p>
        </form>
      )}

      {!loading && invite && (
        <div className="space-y-2">
          <p>
            You used your invite for{" "}
            <span className="font-mono">{invite.email}</span>.
          </p>
          <p className="text-[10px] opacity-70">
            Status:{" "}
            {invite.consumed ? (
              <span className="text-emerald-400">accepted</span>
            ) : (
              <span className="text-amber-300">pending</span>
            )}{" "}
            ({invite.uses}/{invite.maxUses}) · created{" "}
            {new Date(invite.createdAt).toLocaleString()}
          </p>
        </div>
      )}

      {invitedUser && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Invited user
          </h3>
          <p className="mt-1">
            {invitedUser.name ?? invitedUser.email}
            <span className="text-[11px] opacity-70">
              {" "}
              · joined {new Date(invitedUser.createdAt).toLocaleString()}
            </span>
          </p>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-rose-400 mt-1">
          {error}
        </p>
      )}
      {success && (
        <p className="text-[11px] text-emerald-400 mt-1">
          {success}
        </p>
      )}
    </section>
  );
}

// ---- Main profile page ----

export default function ProfilePage() {
  const [data, setData] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // local editable settings
  const [densityMode, setDensityMode] = useState<DensityMode>("normal");
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [defaultMatrixWindow, setDefaultMatrixWindow] = useState("24h");
  const [favoriteSymbolsStr, setFavoriteSymbolsStr] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as
          | ApiProfileResponse
          | null;

        if (!res.ok || !body) {
          throw new Error(body?.error || "Failed to load profile");
        }
        if (!body.ok || !body.profile) {
          throw new Error(body.error || "Profile not available");
        }

        setData(body.profile);

        const s = body.profile.settings;
        setDensityMode(s.densityMode);
        setIsAdvanced(s.isAdvanced);
        setTheme(s.theme);
        setDefaultMatrixWindow(s.defaultMatrixWindow);
        setFavoriteSymbolsStr(s.favoriteSymbols.join(", "));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const favoriteSymbols = favoriteSymbolsStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          densityMode,
          isAdvanced,
          theme,
          defaultMatrixWindow,
          favoriteSymbols,
        }),
      });

      const body = (await res.json().catch(() => null)) as
        | ApiPatchResponse
        | null;

      if (!res.ok || !body || !body.ok || !body.settings) {
        throw new Error(body?.error || "Failed to update settings");
      }

      setData((prev) =>
        prev
          ? {
              ...prev,
              settings: body.settings!,
            }
          : prev
      );
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-4 text-xs opacity-70">Loading profile…</div>;
  }

  if (!data) {
    return (
      <div className="p-4 text-xs text-rose-300">
        Profile not available.
      </div>
    );
  }

  const p = data.profile;

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-wide">
          Profile
        </h1>
        <p className="text-xs opacity-70">
          Identity, preferences and engine-facing behavior for your
          CryptoPhi account.
        </p>
      </header>

      {error && (
        <div className="text-xs text-rose-400 border border-rose-400/60 bg-rose-950/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Identity */}
      <section className="border border-zinc-800 rounded-lg p-3 bg-black/30 flex flex-col gap-1 text-xs">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Identity
        </h2>
        <div>Email: {p.email}</div>
        <div>
          Name:{" "}
          {p.displayName || (
            <span className="opacity-60">not set</span>
          )}
        </div>
        <div>
          Member since:{" "}
          {new Date(p.createdAt).toLocaleDateString()}
        </div>
        <div>
          Invite source:{" "}
          {p.inviteSource || (
            <span className="opacity-60">unknown</span>
          )}
        </div>
      </section>

      {/* Invite box */}
      <InviteSection />

      {/* Preferences */}
      <form
        onSubmit={handleSave}
        className="border border-zinc-800 rounded-lg p-3 bg-black/30 flex flex-col gap-3 text-xs"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Preferences
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Density mode
            </span>
            <select
              value={densityMode}
              onChange={(e) =>
                setDensityMode(e.target.value as DensityMode)
              }
              className="mt-1 rounded-md border border-zinc-700 bg-black/40 px-2 py-1"
            >
              <option value="normal">Normal</option>
              <option value="compact">Compact</option>
            </select>
            <span className="mt-1 text-[10px] opacity-70">
              Normal = more space, Compact = more rows per screen.
            </span>
          </label>

          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={isAdvanced}
              onChange={(e) => setIsAdvanced(e.target.checked)}
            />
            <span>
              Advanced mode
              <span className="block text-[10px] opacity-70">
                Show extra technical controls and internal fields.
              </span>
            </span>
          </label>

          <label className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Theme
            </span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="mt-1 rounded-md border border-zinc-700 bg-black/40 px-2 py-1"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>

          <label className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Default matrix window
            </span>
            <select
              value={defaultMatrixWindow}
              onChange={(e) =>
                setDefaultMatrixWindow(e.target.value)
              }
              className="mt-1 rounded-md border border-zinc-700 bg-black/40 px-2 py-1"
            >
              <option value="24h">24h</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            Favorite symbols
          </span>
          <input
            value={favoriteSymbolsStr}
            onChange={(e) => setFavoriteSymbolsStr(e.target.value)}
            placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
            className="mt-1 rounded-md border border-zinc-700 bg-black/40 px-2 py-1"
          />
          <span className="mt-1 text-[10px] opacity-70">
            Comma-separated tickers. Used as shortcuts in matrices and
            wallet views.
          </span>
        </label>

        <div className="mt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-600/40 text-xs font-medium text-emerald-50 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
