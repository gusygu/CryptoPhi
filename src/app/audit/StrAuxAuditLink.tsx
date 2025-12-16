'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";

function deriveBadge(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return null;
  const first = segments[0]!;
  if (first === "audit" || first === "auth" || first === "docs" || first === "info") return null;
  return first === "api" ? null : first;
}

export default function StrAuxAuditLink() {
  const pathname = usePathname();
  const badge = pathname ? deriveBadge(pathname) : null;
  const href = badge ? `/${badge}/audit/str-aux` : "/audit/str-aux";

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:border-emerald-400/70 hover:bg-emerald-500/15"
    >
      Str-Aux audit
      <span aria-hidden="true" className="text-emerald-200">
        ↗
      </span>
    </Link>
  );
}
