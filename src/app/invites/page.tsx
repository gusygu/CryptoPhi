"use client";

import React, { useEffect, useState } from "react";

type Invite = {
  email: string;
  createdAt: string;
  uses: number;
  maxUses: number;
  consumed: boolean;
};

type InvitedUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
};

export default function InvitesPage() {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [invitedUser, setInvitedUser] = useState<InvitedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/user-invite", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          throw new Error(body?.error || "Failed to load invite");
        }
        setInvite(body.invite ?? null);
        setInvitedUser(body.invitedUser ?? null);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!emailInput.trim()) {
      setError("Please enter an email.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/user-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailInput.trim() }),
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
    <div className="min-h-dvh bg-black text-slate-100">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/70">Invites</p>
          <h1 className="text-2xl font-semibold">Share access</h1>
          <p className="text-sm text-slate-400">
            Every user can send one personal invite. We&apos;ll email a one-time link to the address you enter.
          </p>
        </header>

        <section className="border border-zinc-800 rounded-lg p-4 bg-zinc-950/60 flex flex-col gap-2 text-sm">
          {loading && <p className="text-xs opacity-70">Loading invite status…</p>}

          {!loading && !invite && (
            <form onSubmit={handleCreateInvite} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] uppercase tracking-wide text-zinc-500">Invite email</label>
                <input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="friend@example.com"
                  className="w-full rounded-md border border-zinc-700 bg-black/40 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-md border border-emerald-500/60 bg-emerald-600/50 px-4 py-2 text-sm font-medium text-emerald-50 disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send invite"}
              </button>
              <p className="text-[11px] text-slate-400">
                You have one invite. Once you send it, it can&apos;t be reassigned.
              </p>
            </form>
          )}

          {!loading && invite && (
            <div className="space-y-1 text-sm">
              <p>
                You used your invite for <span className="font-mono">{invite.email}</span>.
              </p>
              <p className="text-[12px] text-slate-400">
                Status:{" "}
                {invite.consumed ? (
                  <span className="text-emerald-400">accepted</span>
                ) : (
                  <span className="text-amber-300">pending</span>
                )}{" "}
                ({invite.uses}/{invite.maxUses}) · created {new Date(invite.createdAt).toLocaleString()}
              </p>
            </div>
          )}

          {invitedUser && (
            <div className="mt-2 border-t border-zinc-800 pt-2 text-sm">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Invited user</h3>
              <p className="mt-1">
                {invitedUser.name ?? invitedUser.email}
                <span className="text-[11px] opacity-70">
                  {" "}
                  · joined {new Date(invitedUser.createdAt).toLocaleString()}
                </span>
              </p>
            </div>
          )}

          {error && <p className="text-[12px] text-rose-400 mt-1">{error}</p>}
          {success && <p className="text-[12px] text-emerald-400 mt-1">{success}</p>}
        </section>
      </main>
    </div>
  );
}
