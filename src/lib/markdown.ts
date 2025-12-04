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
  const fullPath = path.join(process.cwd(), "docs_info", relPath);

  const raw = await fs.readFile(fullPath, "utf8");
  const { content } = matter(raw);

  const remarkModule = await import("remark");
  const remarkFactory =
    (remarkModule as any).remark ??
    (remarkModule as any).default ??
    remarkModule;
  const processed = await remarkFactory().use(html, { sanitize: false }).process(content);
  return processed.toString();
}
