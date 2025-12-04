export interface AdminInviteTemplate {
  template_id: string;
  template_key: string;
  lang: string;
  subject: string;
  description: string | null;
}

export interface AdminInviteLink {
  invite_id: string;
  token: string;
  url: string;
}

export interface AdminInviteStats {
  limit: number;
  used: number;
  remaining: number;
  windowStart: string;
  windowEnd: string;
}
