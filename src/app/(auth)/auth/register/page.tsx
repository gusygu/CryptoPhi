import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getValidInviteByToken, createUserFromInvite } from "@/app/(server)/auth/invites";
import { createSession, ensureAppSessionCookie } from "@/lib/auth/server";

type SearchParams =
  | Promise<URLSearchParams | Record<string, string | string[] | undefined> | null | undefined>
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

type Props = {
  searchParams?: SearchParams;
};

const getParamValue = (params: Awaited<SearchParams>, key: string): string => {
  if (params && typeof (params as URLSearchParams).get === "function") {
    const value = (params as URLSearchParams).get(key);
    return value ?? "";
  }

  const v = (params as Record<string, string | string[] | undefined> | undefined)?.[key];
  return Array.isArray(v) ? v[0] : v || "";
};

async function registerFromInvite(formData: FormData) {
  "use server";

  const token = (formData.get("invite_token") ?? "").toString().trim();
  const nickname =
    (formData.get("nickname") ?? "").toString().trim() || null;
  const password = (formData.get("password") ?? "").toString();
  const confirm = (formData.get("password_confirm") ?? "").toString();

  if (!token) {
    redirect("/auth?err=missing_invite");
  }

  if (!password || password.length < 8) {
    redirect("/auth?err=weak_password");
  }

  if (password !== confirm) {
    redirect("/auth?err=password_mismatch");
  }

  try {
    const user = await createUserFromInvite({
      token,
      nicknameOverride: nickname,
      password,
    });

    await createSession(user.user_id);
    const ensureBadge =
      ensureAppSessionCookie ??
      (await import("@/lib/auth/server")).ensureAppSessionCookie;
    await ensureBadge(user.user_id);
    console.log("[auth] register set sessionId badge for user", user.user_id);
    const jar = await cookies();
    const badge = (jar.get("sessionId")?.value || "").trim() || "global";
    redirect(`/${badge}/dashboard`);
  } catch (err: any) {
    const code =
      err?.message === "suspended_email"
        ? "account_suspended"
        : err?.message === "user_exists"
        ? "account_exists"
        : "invalid_or_used_invite";
    redirect(`/auth?err=${code}`);
  }
}


export default async function RegisterPage({ searchParams }: Props) {
  const resolvedParams = await searchParams;
  const token = getParamValue(resolvedParams, "invite").trim();

  if (!token) {
    redirect("/auth?err=missing_invite");
  }

  const invite = await getValidInviteByToken(token);
  if (!invite) {
    redirect("/auth?err=invalid_or_used_invite");
  }

  const email = invite.email;
  const suggestedNickname =
    invite.requested_nickname ||
    (email.includes("@") ? email.split("@")[0] : email);

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-black">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950/80 px-6 py-6 shadow-lg">
        <h1 className="mb-2 text-lg font-semibold text-zinc-50">
          Complete your registration
        </h1>
        <p className="mb-4 text-sm text-zinc-400">
          You&apos;ve been invited to access{" "}
          <span className="font-semibold text-emerald-300">
            CryptoPi Dynamics
          </span>
          . Confirm your details below to finish.
        </p>

        <form action={registerFromInvite} className="space-y-4">
          <input type="hidden" name="invite_token" value={token} />

          <div>
            <label className="block text-xs font-medium text-zinc-300">
              Email
            </label>
            <input
              type="email"
              name="email"
              readOnly
              value={email}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 opacity-80"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              This email comes from the invite and can&apos;t be changed.
            </p>
          </div>

          <div>
            <label
              htmlFor="nickname"
              className="block text-xs font-medium text-zinc-300"
            >
              Nickname
            </label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              defaultValue={suggestedNickname}
              placeholder="How should we display you?"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-zinc-300"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                minLength={8}
                required
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
              />
            </div>
            <div>
              <label
                htmlFor="password_confirm"
                className="block text-xs font-medium text-zinc-300"
              >
                Confirm password
              </label>
              <input
                id="password_confirm"
                name="password_confirm"
                type="password"
                minLength={8}
                required
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          <button
            type="submit"
            className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-emerald-500/70 bg-emerald-600/80 px-3 py-1.5 text-sm font-medium text-emerald-50 transition hover:bg-emerald-500"
          >
            Complete registration
          </button>
        </form>

        <p className="mt-4 text-xs text-zinc-500">
          Already registered?{" "}
          <a
            href="/auth"
            className="text-emerald-300 underline-offset-2 hover:underline"
          >
            Go to sign in
          </a>
          .
        </p>
      </div>
    </main>
  );
}
