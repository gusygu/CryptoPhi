import { redirect } from "next/navigation";

type Props = { params: { token?: string } };

// Simple bridge that maps /auth/invite/:token -> /auth/register?invite=token
export default function InviteRedirectPage({ params }: Props) {
  const token = decodeURIComponent(params.token ?? "").trim();
  if (!token) {
    redirect("/auth?err=missing_invite");
  }
  redirect(`/auth/register?invite=${encodeURIComponent(token)}`);
}
