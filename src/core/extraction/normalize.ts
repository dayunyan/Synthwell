/** 一条关联:标题 + 为什么相关。batch 与 selection 统一带理由(CONTEXT「关联理由」)。 */
export interface RelatedRef { title: string; reason: string; }

export interface BatchPoint { title: string; summary: string; source_page: number; tags: string[]; related: RelatedRef[]; }

/** Obsidian 标签禁空格/#/|;CJK 允许。把非法字符→_,去首 #,合并连续_,截 100。
 *  解决 LLM 出 "机器学习, NLP" 作单 tag → frontmatter 非法 → 划线(#9)。 */
export function sanitizeTag(t: unknown): string {
  let s = typeof t === "string" ? t : "";
  if (!s) return "";
  s = s.replace(/^#+/, "");
  s = s.replace(/[\s#|]+/g, "_");
  s = s.replace(/[，,、;；:：。.()（）【】\[\]"'`!！?？@&*^%$+=<>{}]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return s.slice(0, 100);
}

/** 拆列表分隔符(逗号/顿号/分号/斜杠),不拆空格(空格留给 sanitizeTag→_)。
 *  非 string → []。 */
export function splitTag(t: unknown): string[] {
  if (typeof t !== "string") return [];
  return t.split(/[,，、;；\\\/]+/).map((s) => s.trim()).filter(Boolean);
}

function unique<T>(a: T[]): T[] { return Array.from(new Set(a)); }

/** 归一化关联列表 → RelatedRef[](信任边界统一:对 batch 与 selection 共用)。
 *  退化兼容:LLM 仍返纯标题字符串 → {title, reason:""}(CONTEXT「关联理由」——不破 schema)。
 *  无 title / 非 string / 空标题 → 丢弃;reason 非 string → ""。 */
export function normalizeRelated(raw: any): RelatedRef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((r: any): RelatedRef | null => {
      if (typeof r === "string") { const t = r.trim(); return t ? { title: t, reason: "" } : null; }
      if (r && typeof r === "object" && typeof r.title === "string") {
        const t = r.title.trim();
        return t ? { title: t, reason: typeof r.reason === "string" ? r.reason.trim() : "" } : null;
      }
      return null;
    })
    .filter((r: RelatedRef | null): r is RelatedRef => r !== null);
}

/** 规范化 LLM 返回的单条知识点:补缺省、强转类型、丢弃无标题的残项。
 *  tags:拆列表分隔 + 逐个 sanitizeTag + 去重(在信任边界统一清洗,避免 frontmatter 非法 tag)。 */
export function normalizePoint(raw: any, fallbackPage: number): BatchPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const page = Number(raw.source_page);
  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(raw.tags)
      ? unique((raw.tags as unknown[]).flatMap(splitTag).map(sanitizeTag).filter((s) => s.length > 0))
      : [],
    related: normalizeRelated(raw.related),
  };
}
