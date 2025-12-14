import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveBadgeFromCookies } from "./page.impl";

export default async function SettingsRedirectPage() {
  const jar = await cookies();
  const badge = resolveBadgeFromCookies(jar);
  if (!badge || badge === "global") {
    redirect("/auth?err=badge_missing");
  }
  redirect(`/${encodeURIComponent(badge)}/settings`);
}
