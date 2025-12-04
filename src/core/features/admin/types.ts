// src/core/features/admin-logs/types.ts
export interface ActionLogEntry {
  actionId: string;
  actorRole: string;
  actorEmail: string;
  actorManagerId: string | null;
  actionKind: string;
  createdAt: string;
  internalAdminId: string | null;
}
