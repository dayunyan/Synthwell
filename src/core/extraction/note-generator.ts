import { ensureFolder } from "../fs/vault-fs.ts";

export interface KnowledgePoint {
  title: string; summary: string;
  source_pdf: string;
  source_page: number;
  source_text: string;
  tags: string[];
  related: string[];
  related_reasons?: { title: string; reason: string }[];  // 关联理由(body 的 ## 关联 显「[[title]] — reason」;batch 与 selection 统一带)
  model: string;
  extraction_mode: "batch" | "selection";
}

/** 文件名 sanitize:保留 CJK,去非法字符,截断 80。 */
export function sanitizeTitle(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 80);
}

/** 渲染笔记(schema)。extracted_at 注入便于测试。 */
export function renderNote(p: KnowledgePoint, extractedAt: string): string {
  // YAML 双引号标量转义:先转义反斜杠(否则末尾 \ 会吞掉闭合引号 → frontmatter 解析失败),
  // 再转义双引号,最后换行→空格(单行标量)。
  const fmText = p.source_text.slice(0, 200).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
  const lines: string[] = ["---"];
  lines.push("shiyue_type: knowledge_point");
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
  if (p.related.length) {
    lines.push("", "## 关联");
    if (p.related_reasons && p.related_reasons.length) {
      p.related_reasons.forEach(rr => lines.push(`- [[${rr.title}]]${rr.reason ? ` — ${rr.reason}` : ""}`));
    } else {
      p.related.forEach(r => lines.push(`- [[${r}]]`));
    }
  }
  lines.push("");
  return lines.join("\n");
}

export interface NoteGeneratorOpts { notesPath: string; model: string; }

/** 纯逻辑 normalizePath 替代(不 import obsidian,避免 node:test ERR_MODULE_NOT_FOUND)。 */
function np(p: string): string { return p.split("/").map(s => s.trim()).filter(Boolean).join("/"); }

export interface NoteAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export class NoteGenerator {
  private adapter: NoteAdapter;
  private opts: NoteGeneratorOpts;
  constructor(adapter: NoteAdapter, opts: NoteGeneratorOpts) {
    this.adapter = adapter; this.opts = opts;
  }
  /** 生成一条知识点笔记。冲突 → -2/-3。返回路径。 */
  async generate(p: KnowledgePoint): Promise<string> {
    const folder = np(`${this.opts.notesPath}/${sanitizeTitle(p.source_pdf)}`);
    await ensureFolder(this.adapter, folder);
    let base = sanitizeTitle(p.title);
    let path = `${folder}/${base}.md`;
    let i = 2;
    while (await this.adapter.exists(path)) { base = `${sanitizeTitle(p.title)} - ${i++}`; path = `${folder}/${base}.md`; }
    const content = renderNote(p, new Date().toISOString().slice(0, 10));
    await this.adapter.write(path, content);
    return path;
  }
}
