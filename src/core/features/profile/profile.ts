// src/core/features/profile.ts

export type DensityMode = "normal" | "compact";

export interface UserProfile {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  invitedBy: string | null;
  inviteSource: string | null;
  locale: string;
  timezone: string;
}

export interface UserSettings {
  userId: string;
  densityMode: DensityMode;
  isAdvanced: boolean;
  theme: string;
  defaultMatrixWindow: string;
  favoriteSymbols: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FullProfile {
  profile: UserProfile;
  settings: UserSettings;
}

export interface UpdateUserSettingsInput {
  densityMode?: DensityMode;
  isAdvanced?: boolean;
  theme?: string;
  defaultMatrixWindow?: string;
  favoriteSymbols?: string[];
}

// --- Dev-only in-memory backing store ---

const DEV_USER_ID = "dev-user";

// default settings; will get mutated in memory
let lastSettings: UserSettings | null = null;

function createDefaultSettings(): UserSettings {
  const now = new Date().toISOString();
  return {
    userId: DEV_USER_ID,
    densityMode: "normal",
    isAdvanced: false,
    theme: "dark",
    defaultMatrixWindow: "24h",
    favoriteSymbols: ["BTCUSDT", "ETHUSDT"],
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultProfile(): UserProfile {
  const now = new Date().toISOString();
  return {
    userId: DEV_USER_ID,
    email: "dev@local",
    displayName: "Dev User",
    createdAt: now,
    invitedBy: null,
    inviteSource: "local-dev",
    locale: "en-US",
    timezone: "America/Sao_Paulo",
  };
}

// Called by GET /api/profile
export async function getFullProfile(): Promise<FullProfile> {
  const profile = createDefaultProfile();
  const settings = lastSettings ?? createDefaultSettings();
  return { profile, settings };
}

// Called by PATCH /api/profile
export async function updateUserSettings(
  patch: UpdateUserSettingsInput
): Promise<UserSettings> {
  const base = lastSettings ?? createDefaultSettings();
  const merged: UserSettings = {
    ...base,
    ...patch,
    favoriteSymbols:
      patch.favoriteSymbols ?? base.favoriteSymbols,
    updatedAt: new Date().toISOString(),
  };
  lastSettings = merged;
  return merged;
}
