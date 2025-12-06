// src/content/docsIndex.ts

export type DocCategoryId =
  | "high-level"
  | "architecture-modules"
  | "database-ddl"
  | "operations"
  | "security-legal-ip"
  | "release-versioning"
  | "client-ux-feature"
  | "dev-helpers"
  | "future-research";

export type DocMeta = {
  id: string;
  slug: string; // URL segment, e.g. "client-guide" -> /docs/client-guide
  title: string;
  file: string; // relative to docs/
  category: DocCategoryId;
  short: string;
  order: number; // per-category ordering
};

export const DOC_CATEGORIES: Record<
  DocCategoryId,
  { label: string; order: number }
> = {
  "high-level": {
    label: "A. High-level / Product",
    order: 1,
  },
  "architecture-modules": {
    label: "B. Architecture & Modules",
    order: 2,
  },
  "database-ddl": {
    label: "C. Database / DDL",
    order: 3,
  },
  operations: {
    label: "D. Operations",
    order: 4,
  },
  "security-legal-ip": {
    label: "E. Security / Legal / IP",
    order: 5,
  },
  "release-versioning": {
    label: "F. Release & Versioning",
    order: 6,
  },
  "client-ux-feature": {
    label: "G. Client UX / Feature semantics",
    order: 7,
  },
  "dev-helpers": {
    label: "H. Dev-only helpers",
    order: 8,
  },
  "future-research": {
    label: "I. Future & Research",
    order: 9,
  },
};

export const DOCS: DocMeta[] = [
  // -------------------------
  // A - High-level / Product
  // -------------------------
  {
    id: "whitepaper",
    slug: "whitepaper",
    title: "Whitepaper",
    file: "WHITEPAPER.md",
    category: "high-level",
    short: "Conceptual and technical framing for CryptoPhi.",
    order: 10,
  },
  {
    id: "readme-from-dev",
    slug: "readme-from-dev",
    title: "README from dev",
    file: "README-from-dev.md",
    category: "high-level",
    short: "Intro note from the dev about the test launch and goals.",
    order: 20,
  },

  // -------------------------
  // B - Architecture / Modules
  // -------------------------
  {
    id: "architecture",
    slug: "architecture",
    title: "Architecture",
    file: "devs/architecture.md",
    category: "architecture-modules",
    short: "System topology, modules, and data movement.",
    order: 10,
  },

  // -------------------------
  // C - Database / DDL
  // -------------------------
  {
    id: "database",
    slug: "database",
    title: "Database",
    file: "devs/database.md",
    category: "database-ddl",
    short: "Schema overview and storage guidance.",
    order: 10,
  },

  // -------------------------
  // D - Operations
  // -------------------------
  {
    id: "operations",
    slug: "operations",
    title: "Operations",
    file: "devs/operations.md",
    category: "operations",
    short: "Operating the stack day-to-day.",
    order: 10,
  },
  {
    id: "backup-and-recovery",
    slug: "backup-and-recovery",
    title: "Backup & Recovery",
    file: "users/backup-and-recovery.md",
    category: "operations",
    short: "Backup, recovery, and resilience guidelines.",
    order: 20,
  },

  // -------------------------
  // E - Security / Legal / IP
  // -------------------------
  {
    id: "security",
    slug: "security",
    title: "Security (Core)",
    file: "devs/security.md",
    category: "security-legal-ip",
    short: "Security posture and controls for the platform.",
    order: 10,
  },
  {
    id: "user-security",
    slug: "user-security",
    title: "Security (User)",
    file: "users/security.md",
    category: "security-legal-ip",
    short: "User-facing security expectations and practices.",
    order: 20,
  },

  // -------------------------
  // F - Release / Versioning
  // -------------------------
  {
    id: "release",
    slug: "release",
    title: "Release",
    file: "release.md",
    category: "release-versioning",
    short: "Release handling and cadence.",
    order: 10,
  },
  {
    id: "versioning",
    slug: "versioning",
    title: "Versioning",
    file: "versioning.md",
    category: "release-versioning",
    short: "Versioning scheme for code and docs.",
    order: 20,
  },

  // -------------------------
  // G - Client UX / Feature semantics
  // -------------------------
  {
    id: "user-guide",
    slug: "user-guide",
    title: "User Guide",
    file: "users/guide.md",
    category: "client-ux-feature",
    short: "Primary user guide for navigating the client.",
    order: 10,
  },
  {
    id: "feature-semantics",
    slug: "feature-semantics",
    title: "Feature Semantics",
    file: "users/feature-semantics.md",
    category: "client-ux-feature",
    short: "UI semantics, matrices, and aux flows.",
    order: 20,
  },
  {
    id: "client-ux-dev",
    slug: "client-ux-dev",
    title: "Client UX (Dev)",
    file: "devs/client-ux.md",
    category: "client-ux-feature",
    short: "Developer notes for UI wiring and behaviours.",
    order: 30,
  },

  // -------------------------
  // H - Dev-only helpers
  // -------------------------
  {
    id: "dev-helpers",
    slug: "dev-helpers",
    title: "Dev Helpers",
    file: "devs/A-dev-helpers.md",
    category: "dev-helpers",
    short: "Local setup, scripts, and debugging aids.",
    order: 10,
  },

  // -------------------------
  // I - Future / Research
  // -------------------------
  {
    id: "future-research",
    slug: "future-research",
    title: "Future / Research",
    file: "future-research.md",
    category: "future-research",
    short: "Research direction and exploratory notes.",
    order: 10,
  },
];

export function getDocBySlug(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}

export function getDocsByCategory(cat: DocCategoryId): DocMeta[] {
  return DOCS.filter((d) => d.category === cat).sort((a, b) => a.order - b.order);
}

export const DEFAULT_DOC_SLUG = "user-guide";
