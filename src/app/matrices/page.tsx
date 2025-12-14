import { cookies } from "next/headers";
import { redirect } from "next/navigation";

function resolveBadge(jar: Awaited<ReturnType<typeof cookies>>): string | null {
  const badge =
    jar.get("sessionId")?.value ||
    jar.get("appSessionId")?.value ||
    jar.get("app_session_id")?.value ||
    "";
  const trimmed = String(badge ?? "").trim();
  return trimmed || null;
}

export default async function MatricesRedirectPage() {
  const jar = await cookies();
  const badge = resolveBadge(jar);
  if (!badge || badge === "global") {
    redirect("/auth?err=badge_missing");
  }
  redirect(`/${encodeURIComponent(badge)}/matrices`);
}
