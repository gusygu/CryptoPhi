import { redirect } from "next/navigation";

export default async function BadgeIndex({
  params,
}: {
  params: { badge?: string };
}) {
  const { badge: badgeParam } = await Promise.resolve(params);
  const badge = (badgeParam ?? "global").trim() || "global";
  redirect(`/${badge}/dashboard`);
}
