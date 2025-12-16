import CinAuxClient from "@/components/features/cin-aux/CinAuxClient";

export default async function CinAuxBadgePage({
  params,
}: {
  params: { badge: string } | Promise<{ badge: string }>;
}) {
  const resolved = await Promise.resolve(params);
  const badge = resolved?.badge ?? "";

  return (
    <main className="min-h-screen w-full bg-slate-50">
      <CinAuxClient badge={badge} />
    </main>
  );
}
