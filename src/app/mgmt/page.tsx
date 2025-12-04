// src/app/mgmt/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

interface Invite {
  invite_id: string;
  target_email: string;
  status: string;
  created_at: string;
  expires_at: string | null;
}

interface CommunityMember {
  member_id: string;
  email: string;
  display_name: string | null;
  status?: string;
  suspended_until?: string | null;
  flagged?: boolean;
  flag_reason?: string | null;
  joined_at: string;
}

interface ApiListInvites {
  ok: boolean;
  invites?: Invite[];
  error?: string;
}

interface ApiListCommunity {
  ok: boolean;
  community?: CommunityMember[];
  error?: string;
}

export default function ManagerMgmtPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [community, setCommunity] = useState<CommunityMember[]>([]);
  const [targetEmail, setTargetEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [managerForbidden, setManagerForbidden] = useState(false);

  async function loadAll() {
    setError(null);
    setManagerForbidden(false);

    try {
      const [invRes, comRes] = await Promise.all([
        fetch("/api/mgmt/invites", { cache: "no-store" }),
        fetch("/api/mgmt/community", { cache: "no-store" }),
      ]);

      // if backend says "not a manager", show locked view
      if (invRes.status === 403 || comRes.status === 403) {
        setManagerForbidden(true);
        setError("This page is only available to community managers.");
        return;
      }

      const invData: ApiListInvites = await invRes.json();
      const comData: ApiListCommunity = await comRes.json();

      if (!invData.ok) throw new Error(invData.error || "Failed invites");
      if (!comData.ok) throw new Error(comData.error || "Failed community");

      setInvites(invData.invites ?? []);
      setCommunity(comData.community ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const totalPeople = useMemo(() => {
    const emails = new Set<string>();
    invites.forEach((i) => emails.add(i.target_email.toLowerCase()));
    community.forEach((m) => emails.add(m.email.toLowerCase()));
    return emails.size;
  }, [invites, community]);

  const invitesLeft = Math.max(0, 20 - totalPeople);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    const emailTrimmed = targetEmail.trim();
    if (!emailTrimmed || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mgmt/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetEmail: emailTrimmed }),
      });

      if (res.status === 403) {
        setManagerForbidden(true);
        throw new Error("This page is only available to community managers.");
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create invite");
      setTargetEmail("");
      setNotice("Invite created.");
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function actionOnMember(
    memberId: string,
    action: "signal" | "suspend" | "unsuspend"
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mgmt/community", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, action }),
      });

      if (res.status === 403) {
        setManagerForbidden(true);
        throw new Error("This page is only available to community managers.");
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to update member");
      await loadAll();
      setNotice(
        action === "signal"
          ? "Member signaled."
          : action === "suspend"
          ? "Member suspended for up to 2 days."
          : "Member reactivated."
      );
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  // If user is not a manager, show locked view and disable everything.
  if (managerForbidden) {
    return (
      <div className="p-4 flex flex-col gap-3 h-full">
        <header className="flex flex-col gap-1">
          <h1 className="text-base font-semibold tracking-wide">
            Manager Community
          </h1>
        </header>
        <div className="text-xs text-rose-300 border border-rose-400/60 bg-rose-950/40 rounded-md px-3 py-2">
          {error ?? "This page is only available to community managers."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-wide">
          Manager Community
        </h1>
        <p className="text-xs opacity-70">
          Invite up to{" "}
          <span className="font-semibold">{20}</span> people. Every
          invite + member counts toward the limit.
        </p>
        <p className="text-xs opacity-80">
          Used:{" "}
          <span className="font-semibold">
            {totalPeople} / 20
          </span>{" "}
          Remaining:{" "}
          <span
            className={
              invitesLeft === 0
                ? "font-semibold text-rose-400"
                : "font-semibold text-emerald-300"
            }
          >
            {invitesLeft}
          </span>
        </p>
      </header>

      {error && (
        <div className="text-xs text-rose-400 border border-rose-400/60 bg-rose-950/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {notice && (
        <div className="text-xs text-emerald-300 border border-emerald-400/60 bg-emerald-950/40 rounded-md px-3 py-2">
          {notice}
        </div>
      )}

      {/* Invite form */}
      <form
        onSubmit={handleCreateInvite}
        className="flex flex-wrap items-center gap-2 border border-zinc-700 rounded-lg px-3 py-2 bg-zinc-950/60"
      >
        <label className="flex-1 min-w-[220px] text-xs">
          <span className="block text-[11px] uppercase tracking-wide text-zinc-500">
            Invite email
          </span>
          <input
            type="email"
            required
            disabled={busy || invitesLeft <= 0}
            value={targetEmail}
            onChange={(e) => setTargetEmail(e.target.value)}
            placeholder="user@example.com"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-50 outline-none focus:border-emerald-400"
          />
        </label>
        <button
          type="submit"
          disabled={busy || invitesLeft <= 0}
          className="px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-600/40 text-xs font-medium text-emerald-50 disabled:opacity-50"
        >
          {busy ? "Working…" : "Send invite"}
        </button>
        {invitesLeft <= 0 && (
          <span className="text-[11px] text-rose-300">
            Invite limit reached.
          </span>
        )}
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {/* Invites list */}
        <section className="border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 bg-black/30">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Invites ({invites.length})
          </h2>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-zinc-900 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Email</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.invite_id} className="border-t border-zinc-800">
                    <td className="px-2 py-1">{i.target_email}</td>
                    <td className="px-2 py-1">{i.status}</td>
                    <td className="px-2 py-1">
                      {new Date(i.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {invites.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-2 py-3 text-center text-[11px] opacity-70"
                    >
                      No invites yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Community list */}
        <section className="border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 bg-black/30">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Community ({community.length})
          </h2>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-zinc-900 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Email</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Joined</th>
                  <th className="px-2 py-1 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {community.map((m) => {
                  const suspended =
                    m.status === "suspended" &&
                    m.suspended_until &&
                    new Date(m.suspended_until).getTime() > Date.now();
                  const statusLabel = suspended
                    ? `suspended until ${new Date(
                        m.suspended_until!
                      ).toLocaleString()}`
                    : m.status ?? "active";
                  return (
                    <tr
                      key={m.member_id}
                      className="border-t border-zinc-800 align-top"
                    >
                      <td className="px-2 py-1">
                        <div>{m.email}</div>
                        {m.flagged && (
                          <div className="text-[10px] text-amber-300">
                            flagged {m.flag_reason && `: ${m.flag_reason}`}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">{statusLabel}</td>
                      <td className="px-2 py-1">
                        {new Date(m.joined_at).toLocaleString()}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              actionOnMember(m.member_id, "signal")
                            }
                            className="rounded border border-amber-500/60 px-2 py-0.5"
                          >
                            Signal
                          </button>
                          {suspended ? (
                            <button
                              type="button"
                              onClick={() =>
                                actionOnMember(m.member_id, "unsuspend")
                              }
                              className="rounded border border-emerald-500/60 px-2 py-0.5"
                            >
                              Unsuspend
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                actionOnMember(m.member_id, "suspend")
                              }
                              className="rounded border border-rose-500/60 px-2 py-0.5"
                            >
                              Suspend (2d)
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {community.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-2 py-3 text-center text-[11px] opacity-70"
                    >
                      No community members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
