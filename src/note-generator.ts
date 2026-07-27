export interface KnowledgePoint {
  title: string; summary: string;
  source_pdf: string;
  source_page: number;
  source_text: string;
  tags: string[];
  related: string[];
  model: string;
  extraction_mode: "batch" | "selection";
}

/** 文件名 sanitize:保留 CJK,去非法字符,截断 80。 */
export function sanitizeTitle(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 80);
}

/** 渲染笔记(schema)。extracted_at 注入便于测试。 */
export function renderNote(p: KnowledgePoint, extractedAt: string): string {
  const fmText = p.source_text.slice(0, 200).replace(/"/g, '\\"').replace(/\n/g, " ");
  const lines: string[] = ["---"];
  lines.push("synthwell_type: knowledge_point");
  lines.push(`source_pdf: "[[${p.source_pdf}]]"`);
  lines.push(`source_page: ${p.source_page}`);
  lines.push(`source_text: "${fmText}"`);
  lines.push(`extracted_at: ${extractedAt}`);
  lines.push(`model: ${p.model}`);
  lines.push(`extraction_mode: ${p.extraction_mode}`);
  lines.push("tags:");
  if (p.tags.length) p.tags.forEach(t => lines.push(`  - ${t}`)); else lines.push("  []");
  lines.push("related:");
  if (p.related.length) p.related.forEach(r => lines.push(`  - "[[${r}]]"`)); else lines.push("  []");
  lines.push("---", "", `# ${p.title}`, "", p.summary, "", "## 原文", `> ${p.source_text}`);
  if (p.related.length) { lines.push("", "## 关联"); p.related.forEach(r => lines.push(`- [[${r}]]`)); }
  lines.push("");
  return lines.join("\n");
}
