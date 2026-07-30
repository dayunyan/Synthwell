import type { KnowledgeNote } from "./synthesizer.ts";
import type { RelatedRef } from "./normalize.ts";

/** 把一条知识点笔记(.md)解析回 KnowledgeNote,供汇总组 SynthesisInput。
 *  与 renderNote(note-generator.ts)对偶:renderNote 序列化,这里反序列化。
 *  - source_text 取 body ## 原文 块的完整片段(优于 frontmatter 的 200 字截断值——综合要完整上下文)。
 *  - related 优先取 body ## 关联 块(带理由);无该块则退到 frontmatter related 标题(reason="")。
 *  容错:缺 frontmatter / 缺字段不抛,给合理缺省(裸 md 也能解析)。 */
export function parseKnowledgeNote(basename: string, content: string): KnowledgeNote {
  const { fm, body } = splitFrontmatter(content);

  const title = firstH1(body) ?? basename;
  const source_pdf = stripWikilink(String(fm.source_pdf ?? ""));
  const page = Number(fm.source_page);
  const tags = readList(fm.tags);
  const source_text = readSourceText(body);
  const summary = readSummary(body);
  const related = readRelatedFromBody(body) ?? readRelatedFromFm(fm.related);

  return {
    title,
    summary,
    source_pdf,
    source_page: Number.isFinite(page) ? page : 0,
    source_text,
    tags,
    related,
  };
}

// ---- frontmatter / body 切分(轻量 YAML-ish,只取所需标量/列表键)----

interface FmLike { [k: string]: unknown }
function splitFrontmatter(content: string): { fm: FmLike; body: string } {
  const fm: FmLike = {};
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return { fm, body: content };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end < 0) return { fm, body: content };  // 未闭合 → 当无 frontmatter
  // 解析 frontmatter 行:支持 `key: value`(标量)与 `key:` 后跟缩进 `- item`(列表)。
  let i = 1;
  while (i < end) {
    const line = lines[i];
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const key = m[1]; const val = m[2].trim();
    if (val === "") {
      // 可能是列表:收集后续缩进 `- ` 行
      const items: string[] = [];
      let j = i + 1;
      for (; j < end; j++) {
        const lm = /^\s+-\s+(.*)$/.exec(lines[j]);
        if (!lm) break;
        items.push(stripQuotes(lm[1].trim()));
      }
      if (items.length) { fm[key] = items; i = j; continue; }
      fm[key] = []; i++; continue;
    }
    fm[key] = scalar(val); i++;
  }
  return { fm, body: lines.slice(end + 1).join("\n") };
}

/** 标量值:去引号;数字转 number;其余字符串。 */
function scalar(v: string): unknown {
  const s = stripQuotes(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function stripWikilink(v: string): string {
  return v.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
}

function readList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x)).filter(Boolean);
}

// ---- body 解析 ----

function firstH1(body: string): string | null {
  for (const line of body.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** summary:第一个 # 标题之后、到下一个 ## 之前的正文(trim,合多行空格)。 */
function readSummary(body: string): string {
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+/.test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/** ## 原文 块:连续 `> ` 行拼回(去前缀,合多行)。 */
function readSourceText(body: string): string {
  const block = readSection(body, "原文");
  if (!block) return "";
  return block
    .map(l => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

/** ## 关联 块:每行 `- [[title]] — reason`(em dash 或连字符;reason 可空)。无该块返回 null(退到 frontmatter)。 */
function readRelatedFromBody(body: string): RelatedRef[] | null {
  const block = readSection(body, "关联");
  if (!block) return null;
  const refs: RelatedRef[] = [];
  for (const line of block) {
    const m = /^-\s+\[\[(.+?)\]\]\s*(?:[—-]\s+(.*))?$/.exec(line.trim());
    if (!m) continue;
    refs.push({ title: m[1].trim(), reason: (m[2] ?? "").trim() });
  }
  return refs;
}

function readRelatedFromFm(v: unknown): RelatedRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(x => ({ title: stripWikilink(String(x)), reason: "" }))
    .filter(r => r.title);
}

/** 取 `## <heading>` 之后到下一个 `## ` 之间的行(不含 heading 行)。 */
function readSection(body: string, heading: string): string[] | null {
  const lines = body.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^##\\s+${escapeRe(heading)}\\s*$`).test(lines[i])) { start = i + 1; break; }
  }
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
