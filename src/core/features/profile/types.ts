// src/core/features/profile/types.ts
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
