// src/lib/markdown.ts
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import html from "remark-html";

export async function renderMarkdownFile(relPath: string): Promise<string> {
  // relPath examples:
  // "A-HIGH-LEVEL/ARCHITECTURE_DEV.md"
  // "G-Client_UX_Feature_Semantics/CLIENT_GUIDE.md"
  // "H-Dev-only_helpers/DEV_SETUP.md"
  const roots = ["docs", "docs_legacy", "docs_info"];
  let raw: string | null = null;
  let lastErr: any;

  for (const root of roots) {
    try {
      const fullPath = path.join(process.cwd(), root, relPath);
      raw = await fs.readFile(fullPath, "utf8");
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (raw == null) {
    throw lastErr ?? new Error(`Unable to read markdown for ${relPath}`);
  }
  const { content } = matter(raw);

  const remarkModule = await import("remark");
  const remarkFactory =
    (remarkModule as any).remark ??
    (remarkModule as any).default ??
    remarkModule;
  const processed = await remarkFactory().use(html, { sanitize: false }).process(content);
  return processed.toString();
}
