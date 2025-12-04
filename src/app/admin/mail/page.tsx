// src/app/admin/mail/page.tsx
"use client";

import { useEffect, useState } from "react";

interface AdminInviteLink {
  invite_id: string;
  token: string;
  url: string;
}

interface Template {
  template_id: string;
  template_key: string;
  lang: string;
  subject: string;
  description: string | null;
}

interface InviteStats {
  limit: number;
  used: number;
  remaining: number;
  windowStart: string;
  windowEnd: string;
}

interface ApiLink {
  ok: boolean;
  link?: AdminInviteLink;
  stats?: InviteStats;
  error?: string;
}

interface ApiTemplates {
  ok: boolean;
  templates?: Template[];
  error?: string;
}

interface ApiSend {
  ok: boolean;
  inviteToken?: string;
  inviteUrl?: string;
  stats?: InviteStats;
  error?: string;
}

interface ApiStats {
  ok: boolean;
  stats?: InviteStats;
  error?: string;
}

export default function AdminCommsPage() {
  const [link, setLink] = useState<AdminInviteLink | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const [toEmail, setToEmail] = useState("");
  const [sending, setSending] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteStats, setInviteStats] = useState<InviteStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Load templates on mount
  useEffect(() => {
    (async () => {
      setTemplatesLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/mail/templates", {
          cache: "no-store",
        });
        if (res.status === 403) {
          throw new Error("Admin access required.");
        }
        const data: ApiTemplates = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed to load templates");
        setTemplates(data.templates ?? []);
        if (data.templates && data.templates[0]) {
          setSelectedTemplate(data.templates[0].template_key);
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setTemplatesLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void loadInviteStats();
  }, []);

  async function loadInviteStats() {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin/mail/invite/stats", {
        cache: "no-store",
      });
      if (res.status === 403) {
        throw new Error("Admin access required.");
      }
      const data: ApiStats = await res.json();
      if (!data.ok || !data.stats) {
        throw new Error(data.error || "Failed to load invite stats");
      }
      setInviteStats(data.stats);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setStatsLoading(false);
    }
  }

  async function handleGenerateLink() {
    setLinkLoading(true);
    setError(null);
    setNotice(null);
    try {
      const trimmed = linkEmail.trim();
      if (!trimmed) {
        throw new Error("Recipient email is required before generating a link.");
      }
      const res = await fetch("/api/admin/mail/invite/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetEmail: trimmed }),
      });
      if (res.status === 403) {
        throw new Error("Admin access required.");
      }
      const data: ApiLink = await res.json();
      if (!data.ok || !data.link) {
        throw new Error(data.error || "Failed to generate link");
      }
      setLink(data.link);
      if (data.stats) {
        setInviteStats(data.stats);
      } else {
        void loadInviteStats();
      }
      setNotice("Invite link generated.");
      setLinkEmail("");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLinkLoading(false);
    }
  }

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = toEmail.trim();
    if (!trimmed || !selectedTemplate || sending) return;

    setSending(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/mail/invite/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toEmail: trimmed,
          templateKey: selectedTemplate,
          inviteToken: link?.token ?? null,
        }),
      });

      if (res.status === 403) {
        throw new Error("Admin access required.");
      }

      const data: ApiSend = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "Failed to send invite");
      }

      setNotice("Invite email queued for sending.");
      if (data.inviteUrl) {
        setLink({
          invite_id: link?.invite_id ?? "n/a",
          token: data.inviteToken ?? (link?.token ?? ""),
          url: data.inviteUrl,
        });
      }
      if (data.stats) {
        setInviteStats(data.stats);
      } else {
        void loadInviteStats();
      }
      setToEmail("");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSending(false);
    }
  }

  const limitReached =
    inviteStats !== null && inviteStats.remaining <= 0 && !statsLoading;
  const canSend =
    !!toEmail.trim() &&
    !!selectedTemplate &&
    !sending &&
    !templatesLoading &&
    !limitReached;

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-wide">
          Admin Communication & Invites
        </h1>
        <p className="text-xs opacity-70">
          Generate invite links and send transactional invitation emails
          signed by an admin.
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

      <section className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wide text-zinc-400">
            Weekly admin invites
          </span>
          {statsLoading && (
            <span className="text-[11px] text-zinc-500">Loading…</span>
          )}
        </div>
        {inviteStats && !statsLoading && (
          <>
            <div>
              Used {" "}
              <span className="font-semibold text-zinc-100">
                {inviteStats.used} / {inviteStats.limit}
              </span>{" "}
              | Remaining {" "}
              <span
                className={
                  inviteStats.remaining === 0
                    ? "font-semibold text-rose-300"
                    : "font-semibold text-emerald-300"
                }
              >
                {inviteStats.remaining}
              </span>
            </div>
            <div className="text-[11px] opacity-70">
              Window resets Monday 12:00 UTC — next reset {" "}
              {new Date(inviteStats.windowEnd).toLocaleString()}
            </div>
          </>
        )}
        {limitReached && (
          <div className="text-[11px] text-rose-300">
            Weekly limit reached. Try again after the reset window.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Shareable link */}
        <section className="border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 bg-black/30">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Shareable Invite Link
          </h2>
          <p className="text-[11px] opacity-70">
            Generate a hashed invite URL that you can paste anywhere
            (chat, DM, etc). It is backed by an admin invite token.
          </p>
          <label className="text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-zinc-500">
              Recipient email
            </span>
            <input
              type="email"
              value={linkEmail}
              onChange={(e) => setLinkEmail(e.target.value)}
              placeholder="user@example.com"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-50 outline-none focus:border-emerald-400"
            />
          </label>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={handleGenerateLink}
              disabled={linkLoading || limitReached}
              className="px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-600/40 text-xs font-medium text-emerald-50 disabled:opacity-50"
            >
              {linkLoading ? "Generating." : "Generate link"}
            </button>
          </div>
          {limitReached && (
            <p className="text-[11px] text-rose-300">
              New invite links are blocked until the next window.
            </p>
          )}
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

        {/* Card 2: Transactional email invite */}
        <section className="border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 bg-black/30">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Transactional Invite Email
          </h2>
          <p className="text-[11px] opacity-70">
            Choose a template and send a Brevo transactional email from{" "}
            <span className="font-semibold">
              cryptophi@mail.cryptophi.xyz
            </span>{" "}
            with an admin signature and invite link.
          </p>

          <form
            onSubmit={handleSendInvite}
            className="mt-2 flex flex-col gap-2"
          >
            <label className="text-xs">
              <span className="block text-[11px] uppercase tracking-wide text-zinc-500">
                Recipient email
              </span>
              <input
                type="email"
                required
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="invitee@example.com"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-50 outline-none focus:border-emerald-400"
              />
            </label>

            <label className="text-xs">
              <span className="block text-[11px] uppercase tracking-wide text-zinc-500">
                Template
              </span>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                disabled={templatesLoading || templates.length === 0}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 text-xs text-zinc-50"
              >
                {templates.map((t) => (
                  <option key={t.template_id} value={t.template_key}>
                    {t.subject} ({t.lang})
                  </option>
                ))}
                {templates.length === 0 && (
                  <option value="">No templates available</option>
                )}
              </select>
            </label>

            {link?.url && (
              <p className="text-[11px] opacity-70">
                Current link will be used:{" "}
                <span className="underline">{link.url}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={!canSend}
              className="mt-2 px-3 py-1 rounded-md border border-emerald-500/60 bg-emerald-600/40 text-xs font-medium text-emerald-50 disabled:opacity-50"
            >
              {sending ? "Sending." : "Send invite email"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
