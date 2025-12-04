import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";

type User = { email: string; nickname?: string; passwordHash: string; createdAt: number };
const USERS = new Map<string, User>(); // DEV convenience map

function hashPassword(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function setSession(email: string) {
  const jar = await cookies();
  jar.set("session", `${email}|${Date.now()}`, { path: "/", httpOnly: true });
}

async function clearSession() {
  const jar = await cookies();
  jar.delete("session");
}

export async function registerAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const nickname = String(formData.get("nickname") || "").trim();
  const pass = String(formData.get("password") || "");
  const pass2 = String(formData.get("password2") || "");

  if (!email || !pass) redirect("/auth?err=Email+and+password+are+required");
  if (pass !== pass2) redirect("/auth?err=Passwords+do+not+match");
  if (USERS.has(email)) redirect("/auth?err=Email+already+registered");

  USERS.set(email, {
    email,
    nickname: nickname || undefined,
    passwordHash: hashPassword(pass),
    createdAt: Date.now(),
  });

  await setSession(email);
  redirect("/auth?ok=registered");
}

export async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const pass = String(formData.get("password") || "");
  const sponsor = String(formData.get("sponsor") || "").trim();

  const u = USERS.get(email);
  if (!u || u.passwordHash !== hashPassword(pass)) {
    redirect("/auth?err=Invalid+email+or+password");
  }

  if (sponsor) {
    const jar = await cookies();
    jar.set("sponsor", sponsor, { path: "/", httpOnly: false });
  }

  await setSession(email);
  redirect("/auth?ok=login");
}

export async function logoutAction(_formData: FormData): Promise<void> {
  "use server";
  await clearSession();
  redirect("/auth?ok=logout");
}
