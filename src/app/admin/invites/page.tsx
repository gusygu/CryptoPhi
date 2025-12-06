// inside src/app/admin/invites/page.tsx
"use client";

import { useState } from "react";
import InvitesAdminClient from "./InvitesAdminClient";

interface AdminInviteLink {
  invite_id: string;
  token: string;
  url: string;
}

interface ApiLink {
  ok: boolean;
  link?: AdminInviteLink;
  error?: string;
}

function AdminInviteLinkBox() {
  const [link, setLink] = useState<AdminInviteLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const email = targetEmail.trim();
      if (!email) {
        throw new Error("Recipient email is required before generating an invite.");
      }
      const res = await fetch("/api/admin/invites/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetEmail: email }),
      });
      if (res.status === 403) {
        throw new Error("Admin access required.");
      }
      const data: ApiLink = await res.json();
      if (!data.ok || !data.link) {
        throw new Error(data.error || "Failed to generate link");
      }
      setLink(data.link);
      setTargetEmail("");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore, browser may block clipboard
    }
  }

  return (
    <section className="border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 bg-black/30">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Registration / Invite Link
      </h2>
      <p className="text-[11px] opacity-70">
        Generate a hashed registration link backed by an admin invite
        token. You can paste it in chat, DM, etc.
      </p>

      {error && (
        <div className="text-[11px] text-rose-300">
          {error}
        </div>
      )}

      <label className="mt-2 text-xs">
        <span className="block text-[11px] uppercase tracking-wide text-zinc-500">
          Recipient email
        </span>
        <input
          type="email"
          autoComplete="email"
          value={targetEmail}
          onChange={(event) => setTargetEmail(event.target.value)}
          placeholder="invitee@example.com"
          disabled={loading}
          className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-50 outline-none focus:border-emerald-400"
        />
      </label>

      <div className="mt-2 flex gap-2 items-center">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-600/40 text-xs font-medium text-emerald-50 disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate link"}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          disabled={!link?.url}
          className="px-2 py-1 rounded-md border border-zinc-700 bg-zinc-900 text-[11px] text-zinc-200 disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <label className="mt-2 text-xs">
        <span className="block text-[11px] uppercase tracking-wide text-zinc-500">
          Invite URL
        </span>
        <input
          type="text"
          readOnly
          value={link?.url ?? ""}
          placeholder="Generate a link to see it here"
          className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-50 opacity-90"
        />
      </label>
    </section>
  );
}

export default function AdminInvitesPage() {
  return (
    <div className="flex flex-col gap-6 text-sm text-zinc-100">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-wide text-zinc-50">
          Admin invites
        </h1>
        <p className="text-xs text-zinc-400">
          Generate invite links and review or approve incoming invite requests.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AdminInviteLinkBox />
        <section className="rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-300">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            How it works
          </h2>
          <ol className="mt-2 list-decimal space-y-2 pl-4 text-[11px] leading-relaxed text-zinc-400">
            <li>
              Click <strong>Generate link</strong> to create a hashed invite URL
              backed by an admin invite token.
            </li>
            <li>
              Share the link in a trusted channel (chat, email, DM). The invite
              expires automatically after 14 days.
            </li>
            <li>
              Keep distribution controlled: each link consumption counts toward
              the admin weekly quota and audit trail.
            </li>
          </ol>
        </section>
      </div>

      <InvitesAdminClient />
    </div>
  );
}
