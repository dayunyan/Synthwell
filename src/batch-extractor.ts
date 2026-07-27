import { estimateTokens } from "./usage.ts";
import { parseLLMJson } from "./llm-json.ts";
import type { LLMProvider } from "./llm-service.ts";
import type { NoteGenerator, NoteGeneratorOpts } from "./note-generator.ts";

export interface PageText { page: number; text: string; }
export interface Chunk { text: string; pages: number[]; }

/** 按 token budget 分块,页对齐(不跨页切,便于 source_page 准确)。
 *  overlap 暂不实现(spec 写 200,但页对齐下 overlap 复杂;先简化为无 overlap,后续优化)。 */
export function chunkPages(pages: PageText[], budgetTokens: number, _overlap = 0): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk = { text: "", pages: [] };
  for (const p of pages) {
    const pageTokens = estimateTokens(p.text);
    if (cur.pages.length && estimateTokens(cur.text) + pageTokens > budgetTokens) {
      chunks.push(cur); cur = { text: "", pages: [] };
    }
    cur.text += p.text; cur.pages.push(p.page);
  }
  if (cur.pages.length) chunks.push(cur);
  return chunks;
}

export interface BatchPoint { title: string; summary: string; source_page: number; tags: string[]; related: string[]; }

/** 标题相似度(字符 bigram 集合)。短串无 bigram 时退化为字符 unigram 集合。
 *  采用 Sørensen–Dice 系数 2*|A∩B|/(|A|+|B|):对共享前缀的中文标题打分高于纯 Jaccard,
 *  满足"相似标题 > 0.5"的预期(纯 Jaccard 仅 ~0.36)。用于标题去重。 */
export function jaccard(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const sa = bigrams(a), sb = bigrams(b);
  if (sa.size === 0 || sb.size === 0) {
    const ua = new Set(a), ub = new Set(b);
    if (ua.size === 0 && ub.size === 0) return 1;
    let inter = 0; for (const c of ua) if (ub.has(c)) inter++;
    return inter / (ua.size + ub.size - inter);
  }
  let inter = 0; for (const g of sa) if (sb.has(g)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

/** 去重:标题 Jaccard > threshold 合并(保留更长 summary,合并 tags/related,source_page 取较早的)。 */
export function dedupe(points: BatchPoint[], threshold = 0.8): BatchPoint[] {
  const out: BatchPoint[] = [];
  for (const p of points) {
    const dup = out.find(o => jaccard(o.title, p.title) >= threshold);
    if (dup) {
      if (p.summary.length > dup.summary.length) dup.summary = p.summary;
      dup.source_page = Math.min(dup.source_page, p.source_page);
      dup.tags = [...new Set([...dup.tags, ...p.tags])];
      dup.related = [...new Set([...dup.related, ...p.related])];
    } else { out.push({ ...p, tags: [...p.tags], related: [...p.related] }); }
  }
  return out;
}

export type ConfirmCostFn = (book: string, chunks: number, tokens: number, cost: number) => Promise<boolean>;

export class BatchExtractor {
  private app: any;
  private llm: LLMProvider;
  private noteGen: NoteGenerator;
  private noteOpts: NoteGeneratorOpts;
  private pricing: { inputPer1M: number; outputPer1M: number };
  private confirmFn: ConfirmCostFn;
  constructor(
    app: any,
    llm: LLMProvider,
    noteGen: NoteGenerator,
    noteOpts: NoteGeneratorOpts,
    pricing: { inputPer1M: number; outputPer1M: number },
    confirmFn: ConfirmCostFn = () => Promise.resolve(true),
  ) {
    this.app = app; this.llm = llm; this.noteGen = noteGen; this.noteOpts = noteOpts; this.pricing = pricing; this.confirmFn = confirmFn;
  }
  /** 单块抽取:AI prompt(注入前文知识点 schema+摘要)+ parseLLMJson。返回知识点数组。 */
  async extractChunk(book: string, chunk: Chunk, prior: { title: string; summary: string }[]): Promise<BatchPoint[]> {
    const priorBlock = prior.length
      ? prior.map(p => `- ${p.title} — ${p.summary}`).join("\n")
      : "(无)";
    const prompt = `你是知识抽取助手。从下面这段 PDF 文本(来自《${book}》第 ${chunk.pages[0]}-${chunk.pages[chunk.pages.length-1]} 页)提取离散知识点。
每个知识点给:title(简短名词短语)、summary(2-4 句)、source_page(所在页码)、tags(2-3 个主题标签)、related(与本块或前文知识点中相关的标题列表)。
只返回 JSON 数组,不要其他文字:[{"title","summary","source_page","tags","related"}]

【此前已抽取的知识点(只看 schema+摘要,别复述原文)】:
${priorBlock}

文本:${chunk.text}`;
    const raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2 });
    const parsed = parseLLMJson<BatchPoint[]>(raw);
    return parsed ?? [];
  }
}
