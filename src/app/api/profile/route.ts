// src/app/api/profile/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session"; // adjust if your auth path is different

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DensityMode = "normal" | "compact";

interface UserProfile {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  invitedBy: string | null;
  inviteSource: string | null;
  locale: string;
  timezone: string;
}

interface UserSettings {
  userId: string;
  densityMode: DensityMode;
  isAdvanced: boolean;
  theme: string;
  defaultMatrixWindow: string;
  favoriteSymbols: string[];
  createdAt: string;
  updatedAt: string;
}

interface FullProfile {
  profile: UserProfile;
  settings: UserSettings;
}

// --- helper: dev/default settings for legacy path ---
function createDefaultSettings(userId: string): UserSettings {
  const now = new Date().toISOString();
  return {
    userId,
    densityMode: "normal",
    isAdvanced: false,
    theme: "dark",
    defaultMatrixWindow: "24h",
    favoriteSymbols: ["BTCUSDT", "ETHUSDT"],
    createdAt: now,
    updatedAt: now,
  };
}

function createLegacyProfile(userId: string, email: string, name?: string | null): UserProfile {
  const now = new Date().toISOString();
  return {
    userId,
    email,
    displayName: name ?? null,
    createdAt: now,
    invitedBy: null,
    inviteSource: "legacy",
    locale: "en-US",
    timezone: "America/Sao_Paulo",
  };
}

/**
 * Hybrid loader:
 * 1) Try new core implementation (preferred);
 * 2) If missing / fails, fall back to legacy profile built from current user.
 */
async function loadHybridProfile(): Promise<FullProfile | null> {
  // Try new module first
  try {
    const mod: any = await import("@/core/features/profile");
    if (mod?.getFullProfile) {
      const full = await mod.getFullProfile();
      if (full) return full as FullProfile;
    }
  } catch {
    // swallow – we’ll fall back to legacy path
  }

  // Legacy fallback: build a minimal profile from current user
  const user = await getCurrentUser();
  if (!user) return null;

  const profile = createLegacyProfile(
    user.user_id,
    user.email,
    user.nickname ?? null
  );
  const settings = createDefaultSettings(user.user_id);

  return { profile, settings };
}

export async function GET() {
  try {
    const full = await loadHybridProfile();
    if (!full) {
      return NextResponse.json(
        { ok: false, error: "Profile not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, profile: full });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // Try to use new core handler if present
    try {
      const mod: any = await import("@/core/features/profile");
      if (mod?.updateUserSettings) {
        const updated = await mod.updateUserSettings({
          densityMode: body.densityMode,
          isAdvanced: body.isAdvanced,
          theme: body.theme,
          defaultMatrixWindow: body.defaultMatrixWindow,
          favoriteSymbols: body.favoriteSymbols,
        });
        return NextResponse.json({ ok: true, settings: updated });
      }
    } catch {
      // fall through to legacy behavior
    }

    // Legacy fallback: just echo back a merged settings struct from current user
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const base = createDefaultSettings(user.user_id);
    const merged: UserSettings = {
      ...base,
      densityMode: body.densityMode ?? base.densityMode,
      isAdvanced:
        typeof body.isAdvanced === "boolean"
          ? body.isAdvanced
          : base.isAdvanced,
      theme: body.theme ?? base.theme,
      defaultMatrixWindow:
        body.defaultMatrixWindow ?? base.defaultMatrixWindow,
      favoriteSymbols:
        Array.isArray(body.favoriteSymbols) &&
        body.favoriteSymbols.length > 0
          ? body.favoriteSymbols
          : base.favoriteSymbols,
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ ok: true, settings: merged });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
