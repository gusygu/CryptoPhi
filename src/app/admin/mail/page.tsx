// src/app/admin/mail/page.tsx

"use client";

import { useEffect, useState } from "react";
import { NonJsonResponseError, safeJson } from "@/lib/client/safeJson";

interface InviteLink {
  inviteId: string;
  inviteUrl: string;
  expiresAt: string;
}

interface Template {
  template_id: string;
  template_key: string;
  lang: string;
  subject: string;
  description: string | null;
}

interface InviteStats {
  weekUsed: number;
  weekLimit: number;
  lifetimeUsed: number;
  lifetimeLimit: number;
  tier: string;
}

type ApiError = string | { code?: string; message?: string };

interface ApiLinkResponse {
  ok: boolean;
  data?: {
    inviteId: string;
    inviteUrl: string;
    expiresAt: string;
    stats?: any;
  };
  error?: ApiError;
}

interface ApiTemplatesResponse {
  ok: boolean;
  data?: { templates: Template[] };
  error?: ApiError;
}

interface ApiStatsResponse {
  ok: boolean;
  data?: any;
  error?: ApiError;
}

interface ApiSendResponse {
  ok: boolean;
  data?: { inviteToken?: string; inviteUrl?: string; stats?: any; message?: string; sent?: boolean };
  inviteToken?: string; // legacy shape
  inviteUrl?: string;
  stats?: any;
  message?: string;
  error?: ApiError;
}

function normalizeStats(raw: any): InviteStats | null {
  if (!raw) return null;
  if (
    typeof raw.weekUsed === "number" &&
    typeof raw.weekLimit === "number" &&
    typeof raw.lifetimeUsed === "number" &&
    typeof raw.lifetimeLimit === "number" &&
    typeof raw.tier === "string"
  ) {
    return raw as InviteStats;
  }
  if (typeof raw.limit === "number" && typeof raw.used === "number") {
    return {
      tier: "admin",
      weekUsed: raw.used,
      weekLimit: raw.limit,
      lifetimeUsed: raw.used,
      lifetimeLimit: raw.limit,
    };
  }
  if (
    typeof raw.week_limit === "number" &&
    typeof raw.week_used === "number" &&
    typeof raw.lifetime_limit === "number" &&
    typeof raw.lifetime_used === "number"
  ) {
    return {
      tier: raw.tier ?? "admin",
      weekLimit: raw.week_limit,
      weekUsed: raw.week_used,
      lifetimeLimit: raw.lifetime_limit,
      lifetimeUsed: raw.lifetime_used,
    };
  }
  return null;
}

function describeError(err: unknown): string {
  if (err instanceof NonJsonResponseError) {
    return `${err.message} (status ${err.status})${err.snippet ? `: ${err.snippet}` : ""}`;
  }
  if (typeof err === "object" && err !== null && "message" in (err as any)) {
    return String((err as any).message);
  }
  return String(err);
}

function errorFromPayload(error?: ApiError | null) {
  if (!error) return "Request failed";
  if (typeof error === "string") return error;
  return error.message || error.code || "Request failed";
}

function tokenFromLink(link: InviteLink | null) {
  if (!link?.inviteUrl) return null;
  try {
    const url = new URL(link.inviteUrl);
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

export default function AdminCommsPage() {
  const [link, setLink] = useState<InviteLink | null>(null);
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

  useEffect(() => {
    (async () => {
      setTemplatesLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/mail/templates", { cache: "no-store" });
        if (res.status === 403) {
          throw new Error("Admin access required.");
        }
        const data = await safeJson<ApiTemplatesResponse>(res);
        if (!data.ok) {
          throw new Error(errorFromPayload(data.error));
        }
        const list = data.data?.templates ?? [];
        setTemplates(list);
        if (list[0]) {
          setSelectedTemplate(list[0].template_key);
        }
      } catch (e) {
        setError(describeError(e));
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
      const res = await fetch("/api/admin/mail/invite/stats", { cache: "no-store" });
      if (res.status === 403) {
        throw new Error("Admin access required.");
      }
      const data = await safeJson<ApiStatsResponse>(res);
      if (!data.ok) {
        throw new Error(errorFromPayload(data.error));
      }
      const stats = normalizeStats(data.data);
      if (!stats) {
        throw new Error("Failed to load invite stats");
      }
      setInviteStats(stats);
    } catch (e) {
      setError(describeError(e));
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
      const data = await safeJson<ApiLinkResponse>(res);
      if (!data.ok || !data.data) {
        throw new Error(errorFromPayload(data.error));
      }
      setLink({
        inviteId: data.data.inviteId,
        inviteUrl: data.data.inviteUrl,
        expiresAt: data.data.expiresAt,
      });

      const stats = normalizeStats(data.data.stats);
      if (stats) {
        setInviteStats(stats);
      } else {
        void loadInviteStats();
      }
      setNotice("Invite link generated.");
      setLinkEmail("");
    } catch (e) {
      setError(describeError(e));
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
          inviteToken: tokenFromLink(link),
        }),
      });

      if (res.status === 403) {
        throw new Error("Admin access required.");
      }

      const data = await safeJson<ApiSendResponse>(res);
      if (!data.ok) {
        throw new Error(errorFromPayload(data.error));
      }

      const message =
        data.data?.message ?? data.message ?? "Invite email queued for sending.";
      setNotice(message);

      const nextUrl = data.data?.inviteUrl ?? data.inviteUrl ?? link?.inviteUrl ?? null;
      if (nextUrl) {
        setLink({
          inviteId: link?.inviteId ?? "n/a",
          inviteUrl: nextUrl,
          expiresAt: link?.expiresAt ?? "",
        });
      }

      const stats = normalizeStats(data.data?.stats ?? data.stats);
      if (stats) {
        setInviteStats(stats);
      } else {
        void loadInviteStats();
      }
      setToEmail("");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  }

  const remainingBudget =
    inviteStats === null
      ? null
      : Math.max(
          0,
          inviteStats.tier === "admin"
            ? inviteStats.weekLimit - inviteStats.weekUsed
            : inviteStats.lifetimeLimit - inviteStats.lifetimeUsed
        );

  const limitReached = remainingBudget !== null && remainingBudget <= 0 && !statsLoading;
  const canSend =
    !!toEmail.trim() && !!selectedTemplate && !sending && !templatesLoading && !limitReached;

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold tracking-wide">Admin Communication & Invites</h1>
        <p className="text-xs opacity-70">
          Generate invite links and send transactional invitation emails signed by an admin.
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
            Invite capacity
          </span>
          {statsLoading && <span className="text-[11px] text-zinc-500">Loading.</span>}
        </div>
        {inviteStats && !statsLoading && (
          <>
            <div>
              Tier: <span className="font-semibold text-zinc-100">{inviteStats.tier}</span>
            </div>
            <div>
              Weekly (rolling 7d):{" "}
              <span className="font-semibold text-zinc-100">
                {inviteStats.weekUsed} / {inviteStats.weekLimit}
              </span>
            </div>
            <div>
              Lifetime:{" "}
              <span className="font-semibold text-zinc-100">
                {inviteStats.lifetimeUsed} / {inviteStats.lifetimeLimit}
              </span>
            </div>
            <div className="text-[11px] opacity-70">
              Remaining invites:{" "}
              <span
                className={
                  remainingBudget === 0 ? "font-semibold text-rose-300" : "font-semibold text-emerald-300"
                }
              >
                {remainingBudget ?? 0}
              </span>
            </div>
          </>
        )}
        {limitReached && (
          <div className="text-[11px] text-rose-300">
            Invite limit reached. Try again after the window resets.
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
            Generate a hashed invite URL that you can paste anywhere (chat, DM, etc). It is backed
            by an admin invite token.
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
              value={link?.inviteUrl ?? ""}
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
            <span className="font-semibold">cryptophi@mail.cryptophi.xyz</span> with an admin
            signature and invite link.
          </p>

          <form onSubmit={handleSendInvite} className="mt-2 flex flex-col gap-2">
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
                {templates.length === 0 && <option value="">No templates available</option>}
              </select>
            </label>

            {link?.inviteUrl && (
              <p className="text-[11px] opacity-70">
                Current link will be used: <span className="underline">{link.inviteUrl}</span>
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
