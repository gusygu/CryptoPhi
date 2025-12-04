"// src/app/admin/mgmt/AdminMgmtClient.tsx"
"use client";

import { useEffect, useState } from "react";
import type {
  Manager,
  ManagerOverview,
} from "@/core/features/admin-mgmt/types";

interface ApiListManagers {
  ok: boolean;
  managers?: Manager[];
  error?: string;
}

interface ApiOverview {
  ok: boolean;
  overview?: ManagerOverview;
  error?: string;
}

export default function AdminMgmtClient() {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overview, setOverview] = useState<ManagerOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // load managers list once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/mgmt/managers", {
          cache: "no-store",
        });
        const data: ApiListManagers = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed");
        setManagers(data.managers ?? []);
        if (!selectedId && data.managers && data.managers[0]) {
          setSelectedId(data.managers[0].manager_id);
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    })();
  }, []);

  // load overview when manager changes
  useEffect(() => {
    if (!selectedId) return;
    setLoadingOverview(true);
    setOverview(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/admin/mgmt/managers/${selectedId}/overview`,
          { cache: "no-store" }
        );
        const data: ApiOverview = await res.json();
        if (!data.ok) throw new Error(data.error || "Failed");
        setOverview(data.overview ?? null);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoadingOverview(false);
      }
    })();
  }, [selectedId]);

  return (
    <div className="flex h-full gap-4 p-4">
      {/* left: managers list */}
      <div className="w-80 border rounded-lg p-3 flex flex-col gap-2">
        <h2 className="font-semibold text-sm tracking-wide uppercase mb-1">
          Managers
        </h2>
        <div className="flex-1 overflow-auto space-y-1 text-sm">
          {managers.map((m) => (
            <button
              key={m.manager_id}
              onClick={() => setSelectedId(m.manager_id)}
              className={`w-full text-left px-2 py-1 rounded-md border ${
                selectedId === m.manager_id
                  ? "bg-slate-900 text-slate-50"
                  : "bg-slate-50 hover:bg-slate-100"
              }`}
            >
              <div className="flex justify-between">
                <span>{m.display_name || m.email}</span>
                <span className="text-xs opacity-70">{m.status}</span>
              </div>
              <div className="text-xs opacity-70">
                sig: {m.signature_email}
              </div>
            </button>
          ))}
          {managers.length === 0 && (
            <div className="text-xs opacity-70">No managers yet.</div>
          )}
        </div>
      </div>

      {/* right: overview */}
      <div className="flex-1 border rounded-lg p-3 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold text-sm tracking-wide uppercase">
            Manager overview
          </h2>
          {loadingOverview && (
            <span className="text-xs opacity-70 animate-pulse">
              Loading…
            </span>
          )}
        </div>

        {error && (
          <div className="text-xs text-red-600 border border-red-300 rounded-md p-2 bg-red-50">
            {error}
          </div>
        )}

        {!overview && !loadingOverview && !error && (
          <div className="text-xs opacity-70">
            Select a manager on the left to see details.
          </div>
        )}

        {overview && (
          <div className="flex flex-col gap-3 text-sm overflow-auto">
            {/* header */}
            <div>
              <div className="font-medium">
                {overview.manager.display_name ||
                  overview.manager.email}
              </div>
              <div className="text-xs opacity-70">
                {overview.manager.email} • sig:{" "}
                {overview.manager.signature_email}
              </div>
            </div>

            {/* invites */}
            <section>
              <h3 className="font-semibold text-xs uppercase mb-1">
                Invites ({overview.invites.length})
              </h3>
              <div className="border rounded-md max-h-40 overflow-auto text-xs">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">Email</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.invites.map((i) => (
                      <tr key={i.invite_id} className="border-t">
                        <td className="px-2 py-1">{i.target_email}</td>
                        <td className="px-2 py-1">{i.status}</td>
                        <td className="px-2 py-1">
                          {new Date(
                            i.created_at
                          ).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {overview.invites.length === 0 && (
                      <tr>
                        <td
                          className="px-2 py-2 text-center opacity-60"
                          colSpan={3}
                        >
                          No invites yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* community */}
            <section>
              <h3 className="font-semibold text-xs uppercase mb-1">
                Community ({overview.community.length})
              </h3>
              <div className="border rounded-md max-h-40 overflow-auto text-xs">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">Email</th>
                      <th className="px-2 py-1 text-left">Source</th>
                      <th className="px-2 py-1 text-left">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.community.map((m) => (
                      <tr key={m.member_id} className="border-t">
                        <td className="px-2 py-1">{m.email}</td>
                        <td className="px-2 py-1">
                          {m.source ?? "-"}
                        </td>
                        <td className="px-2 py-1">
                          {new Date(
                            m.joined_at
                          ).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {overview.community.length === 0 && (
                      <tr>
                        <td
                          className="px-2 py-2 text-center opacity-60"
                          colSpan={3}
                        >
                          No community members yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            {/* actions */}
            <section>
              <h3 className="font-semibold text-xs uppercase mb-1">
                Recent actions
              </h3>
              <div className="border rounded-md max-h-40 overflow-auto text-xs">
                <table className="w-full border-collapse">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">When</th>
                      <th className="px-2 py-1 text-left">Kind</th>
                      <th className="px-2 py-1 text-left">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recentActions.map((a) => (
                      <tr key={a.action_id} className="border-t">
                        <td className="px-2 py-1">
                          {new Date(
                            a.created_at
                          ).toLocaleString()}
                        </td>
                        <td className="px-2 py-1">
                          {a.action_kind}
                        </td>
                        <td className="px-2 py-1">
                          {a.target_email ?? "-"}
                        </td>
                      </tr>
                    ))}
                    {overview.recentActions.length === 0 && (
                      <tr>
                        <td
                          className="px-2 py-2 text-center opacity-60"
                          colSpan={3}
                        >
                          No actions recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
