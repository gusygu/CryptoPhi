import { redirect } from "next/navigation";

export default async function BadgeIndex({
  params,
}: {
  params: { badge?: string };
}) {
  const badge = (params?.badge ?? "global").trim() || "global";
  redirect(`/${badge}/dashboard`);
}
