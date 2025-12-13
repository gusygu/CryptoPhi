import { redirect } from "next/navigation";

export default async function BadgeIndex({
  params,
}: {
  params: { badge?: string } | Promise<{ badge?: string }>;
}) {
  const resolved = typeof (params as any)?.then === "function" ? await (params as Promise<{ badge?: string }>) : (params as { badge?: string });
  const badge = (resolved?.badge ?? "global").trim() || "global";
  redirect(`/${badge}/dashboard`);
}
