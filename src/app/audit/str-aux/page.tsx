import { requireUserSession } from "@/app/(server)/auth/session";
import StrAuxSamplingAuditClient from "./StrAuxSamplingAuditClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StrAuxSamplingAuditPage() {
  await requireUserSession();
  return (
    <main className="px-4 py-8 text-sm text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <StrAuxSamplingAuditClient />
      </div>
    </main>
  );
}
