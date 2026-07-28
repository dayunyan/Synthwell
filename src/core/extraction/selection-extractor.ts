import type { LLMProvider, ChatMsg } from "../llm/llm-service.ts";
import { parseLLMJson } from "../llm/llm-json.ts";
import { sanitizeTag, splitTag } from "./normalize.ts";

function unique<T>(a: T[]): T[] { return Array.from(new Set(a)); }

export interface SelectionRelated { title: string; reason: string; }
export interface SelectionPoint {
  title: string; summary: string;
  source_page: number;
  tags: string[];
  related: SelectionRelated[];
}

/** 从 LLM 返回里抠出单个点对象:裸对象 / {point:{...}} / [{}]。
 *  常见 LLM 把点包在 {point:{...}} / {result:{...}} / {knowledge_point:{...}} 里, digs into first object-valued field。 */
function extractObject(raw: any): any | null {
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  // 裸点对象(有 title)直接用;否则若被包在单个 key 里({point:{...}} 等),抠内层。
  if (typeof raw.title === "string") return raw;
  const values = Object.values(raw).filter((v) => v && typeof v === "object") as any[];
  if (values.length === 1) return values[0];
  return raw;
}

/** 归一化单点:强转类型,缺 title → null,related 非数组 → []。 */
function normalizeSelectionPoint(raw: any, fallbackPage: number): SelectionPoint | null {
  const o = extractObject(raw);
  if (!o) return null;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  const page = Number(o.source_page);
  const related: SelectionRelated[] = Array.isArray(o.related)
    ? o.related.filter((r: any) => r && typeof r.title === "string" && r.title.trim())
      .map((r: any) => ({ title: String(r.title).trim(), reason: typeof r.reason === "string" ? r.reason.trim() : "" }))
    : [];
  return {
    title,
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(o.tags)
      ? unique((o.tags as unknown[]).flatMap(splitTag).map(sanitizeTag).filter((s) => s.length > 0))
      : [],
    related,
  };
}

/** 选区即抽:基于(选中段 + 上下文 + 已有知识点标题)抽单个知识点,带 related 理由。
 *  纯逻辑:contextText / existingTitles 由调用方组装(main.ts 从 doc + vault 拿)。 */
export class SelectionExtractor {
  private llm: LLMProvider;
  constructor(llm: LLMProvider) { this.llm = llm; }
  async extract(book: string, selected: string, page: number, contextText: string, existingTitles: string[], signal?: AbortSignal): Promise<SelectionPoint | null> {
    const titlesBlock = existingTitles.length ? existingTitles.map(t => `- ${t}`).join("\n") : "(无)";
    const prompt = `你是知识抽取助手。用户从《${book}》第 ${page} 页选中了一段,想把它抽成一个知识点笔记。
基于选中段 + 上下文,提取一个知识点:title(名词短语)、summary(2-4 句)、source_page(所在页码)、tags(2-3 个主题标签)。
并从已有知识点标题里找出关联的(给 related 列表,每个附一句关联理由)。
只返回 JSON:{"title","summary","source_page","tags","related":[{"title","reason"}]}

选中:${selected}
上下文(第 ${Math.max(1, page - 2)}-${page + 2} 页):${contextText}
已有知识点:
${titlesBlock}`;
    let raw: string;
    try {
      raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2, signal });
    } catch (e) {
      if (signal?.aborted) return null;  // 取消 → null(controller 不报错)
      throw e;  // 其他错抛出
    }
    const parsed = parseLLMJson<any>(raw);
    if (parsed == null) return null;
    return normalizeSelectionPoint(parsed, page);
  }
}
