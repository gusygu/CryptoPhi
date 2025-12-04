export type ManagerStatus = "active" | "blocked" | "archived";

export interface Manager {
  manager_id: string;
  email: string;
  display_name: string | null;
  signature_email: string;
  status: ManagerStatus;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  internal_admin_id: string | null;
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invite {
  invite_id: string;
  target_email: string;
  created_by_role: "admin" | "manager" | "system";
  created_by_email: string | null;
  manager_id: string | null;
  status: InviteStatus;
  token: string;
  expires_at: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  last_mail_id: string | null;
  notes: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CommunityMember {
  member_id: string;
  email: string;
  display_name: string | null;
  invite_id: string | null;
  manager_id: string | null;
  source: string | null;
  joined_at: string;
  last_seen_at: string | null;
  meta: Record<string, unknown>;
  status: "active" | "suspended" | "archived";
  suspended_until: string | null;
  flagged: boolean;
  flag_reason: string | null;
  flagged_at: string | null;
}

export type MailStatus = "pending" | "sending" | "sent" | "failed" | "cancelled";

export interface MailQueueItem {
  mail_id: string;
  to_email: string;
  template_key: string | null;
  subject_override: string | null;
  status: MailStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  trigger_role: "admin" | "manager" | "system" | null;
  trigger_email: string | null;
  manager_id: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
}

export interface AdminAction {
  action_id: string;
  action_kind: string;
  action_scope: string | null;
  actor_role: "admin" | "manager" | "system" | null;
  actor_email: string | null;
  manager_id: string | null;
  target_email: string | null;
  invite_id: string | null;
  member_id: string | null;
  mail_id: string | null;
  snapshot_id: string | null;
  payload: Record<string, unknown>;
  notes: string | null;
  created_at: string;
}

export interface ManagerOverview {
  manager: Manager;
  invites: Invite[];
  community: CommunityMember[];
  recentActions: AdminAction[];
  recentMail: MailQueueItem[];
}
