import CinAuxClient from "@/components/features/cin-aux/CinAuxClient";
import { requireUserSession } from "@/app/(server)/auth/session";

export default async function CinPage() {
  const session = await requireUserSession();
  const badge = (session as any)?.sessionId ?? (session as any)?.badge ?? null;
  if (!badge) {
    return null;
  }

  return (
    <main className="min-h-screen w-full bg-slate-50">
      <CinAuxClient badge={String(badge)} />
    </main>
  );
}
