import { requireUserSession } from "@/app/(server)/auth/session";
import AdminMgmtClient from "./AdminMgmtClient";

export default async function AdminMgmtPage() {
  await requireUserSession();
  return <AdminMgmtClient />;
}
