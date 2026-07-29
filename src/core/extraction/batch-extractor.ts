import { estimateTokens, estimateCost } from "../llm/usage.ts";
import { parseLLMJson } from "../llm/llm-json.ts";
import type { LLMProvider } from "../llm/llm-service.ts";
import type { NoteGenerator, NoteGeneratorOpts } from "./note-generator.ts";
import type { DocumentSource } from "../document/document-source.ts";
import type { ExtractionState } from "./extraction-state.ts";
import { normalizePoint, type BatchPoint, type RelatedRef } from "./normalize.ts";
export type { BatchPoint };

export interface PageText { page: number; text: string; }
export interface Chunk { text: string; pages: number[]; }

/** 按 token budget 分块,页对齐 + 章节边界对齐。
 *  长文档(totalTokens>longDocThreshold)且自然分块<3 时,降 budget=ceil(total/3) 强制≥3 块。
 *  chapters:章首页码列表;在该页前若当前块非空则切(尽量同章不跨块)。 */
export function chunkPages(pages: PageText[], budgetTokens: number, _overlap = 0, chapters: number[] = [], longDocThreshold = 10000): Chunk[] {
  if (pages.length === 0) return [];
  const totalTokens = pages.reduce((s, p) => s + estimateTokens(p.text), 0);
  let budget = budgetTokens;
  if (totalTokens > longDocThreshold) {
    const natural = chunkByBudget(pages, budget, chapters);
    if (natural.length < 3) budget = Math.max(1, Math.ceil(totalTokens / 3));
  }
  return chunkByBudget(pages, budget, chapters);
}

function chunkByBudget(pages: PageText[], budgetTokens: number, chapters: number[]): Chunk[] {
  const bounds = new Set(chapters.filter((p) => p >= 1));
  const chunks: Chunk[] = [];
  let cur: Chunk = { text: "", pages: [] };
  const push = () => { if (cur.pages.length) { chunks.push(cur); cur = { text: "", pages: [] }; } };
  for (const p of pages) {
    const pageTokens = estimateTokens(p.text);
    const overBudget = cur.pages.length && estimateTokens(cur.text) + pageTokens > budgetTokens;
    const atChapterStart = cur.pages.length && bounds.has(p.page);
    if (overBudget || atChapterStart) push();
    cur.text += p.text; cur.pages.push(p.page);
  }
  push();
  return chunks;
}

/** 兜底合成 1 个知识点(每块≥1 保底的第三层:prompt→重试→合成)。
 *  title=首行或首 40 字;summary=首 ~120 字;source_page=chunk 首页;tags/related 空。 */
export function synthesizePoint(chunk: Chunk): BatchPoint {
  const text = chunk.text.trim();
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const title = (firstLine || text).slice(0, 40) || `第${chunk.pages[0]}页摘要`;
  return {
    title,
    summary: text.slice(0, 120) || title,
    source_page: chunk.pages[0],
    tags: [],
    related: [],
  };
}

/** best-effort 从 PDF outline 取章首页码。无 outline / 解析失败 → [](退回纯页对齐)。 */
async function chapterBoundaries(doc: any): Promise<number[]> {
  try {
    const outline = await doc.getOutline?.();
    if (!Array.isArray(outline) || !outline.length) return [];
    const pages: number[] = [];
    for (const item of outline) {
      const dest = item?.dest;
      const ref = Array.isArray(dest) && dest.length ? dest[0] : null;
      if (ref == null) continue;
      try { const idx = await doc.getPageIndex(ref); pages.push(idx + 1); } catch { /* skip unresolvable */ }
    }
    return Array.from(new Set(pages)).sort((a, b) => a - b);
  } catch { return []; }
}

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

/** 合并关联列表:按 title 去重(先出现的理由优先保留——理由是 AI 明确判过的强关联,不覆盖)。 */
function mergeRelated(a: RelatedRef[], b: RelatedRef[]): RelatedRef[] {
  const map = new Map<string, RelatedRef>();
  for (const r of [...a, ...b]) if (!map.has(r.title)) map.set(r.title, r);
  return [...map.values()];
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
      dup.related = mergeRelated(dup.related, p.related);
    } else { out.push({ ...p, tags: [...p.tags], related: [...p.related] }); }
  }
  return out;
}

export type ConfirmCostFn = (book: string, chunks: number, tokens: number, cost: number) => Promise<boolean>;

/** 规范化 LLM 返回的单条知识点:补缺省、强转类型、丢弃无标题的残项。
 *  LLM 输出不可信(tags/related 可能缺失或为 null、source_page 可能是字符串),
 *  在 extractChunk 边界统一清洗,避免 dedupe 里 `[...p.tags]` 炸 "not iterable"。
 *  实现见 ./normalize.ts。 */
export interface ExtractOpts {
  onProgress?: (done: number, total: number, points: number) => void;
  onConfirmed?: (totalChunks: number) => void;  // #4:confirm 通过后调,传总块数(controller 显 "0/N")
  signal?: AbortSignal;
}
export interface ExtractChunkOpts { forceAtLeastOne?: boolean; signal?: AbortSignal; }

export interface ExtractResult {
  count: number;       // 生成的知识点数
  chunks: number;      // 总块数
  cancelled: boolean;  // 用户在弹窗取消
  message: string;     // 人类可读结论(给 Notice)
}

export class BatchExtractor {
  private app: any;
  private llm: LLMProvider;
  private noteGen: NoteGenerator;
  private noteOpts: NoteGeneratorOpts;
  private pricing: { inputPer1M: number; outputPer1M: number };
  private confirmFn: ConfirmCostFn;
  private state: ExtractionState | null;
  constructor(
    app: any,
    llm: LLMProvider,
    noteGen: NoteGenerator,
    noteOpts: NoteGeneratorOpts,
    pricing: { inputPer1M: number; outputPer1M: number },
    confirmFn: ConfirmCostFn = () => Promise.resolve(true),
    state: ExtractionState | null = null,
  ) {
    this.app = app; this.llm = llm; this.noteGen = noteGen; this.noteOpts = noteOpts; this.pricing = pricing; this.confirmFn = confirmFn; this.state = state;
  }
  /** 单块抽取:AI prompt(注入前文知识点 schema+摘要)+ parseLLMJson。返回知识点数组。
   *  opts.forceAtLeastOne:prompt 加强制语,要求≥1 条。opts.signal:透传 llm.chat(取消线程)。
   *  llm.chat 抛错(含 abort)→ catch 返回 [](extract 层兜底合成)。 */
  async extractChunk(book: string, chunk: Chunk, prior: { title: string; summary: string }[], opts: ExtractChunkOpts = {}): Promise<BatchPoint[]> {
    const priorBlock = prior.length ? prior.map(p => `- ${p.title} — ${p.summary}`).join("\n") : "(无)";
    const forceLine = opts.forceAtLeastOne
      ? "\n【重要:必须返回至少1条知识点,哪怕内容稀薄也提取最核心的一条。禁止返回空数组。】"
      : "";
    const prompt = `你是知识抽取助手。从下面这段 PDF 文本(来自《${book}》第 ${chunk.pages[0]}-${chunk.pages[chunk.pages.length-1]} 页)提取离散知识点。
每个知识点给:title(简短名词短语)、summary(2-4 句)、source_page(所在页码)、tags(2-3 个主题标签)、related(与本块或前文知识点中相关的标题,每条附一句关联理由)。
只返回 JSON 数组,不要其他文字:[{"title","summary","source_page","tags","related":[{"title","reason"}]}]${forceLine}

【此前已抽取的知识点(只看 schema+摘要,别复述原文)】:
${priorBlock}

文本:${chunk.text}`;
    let raw: string;
    try {
      raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2, signal: opts.signal });
    } catch (e) {
      console.warn(`[shiyue] 块抽取失败(将兜底):${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
    const parsed = parseLLMJson<any>(raw);
    // 模型可能把数组包在对象里 {"points":[...]} / {"knowledge_points":[...]} / {"result":[...]}
    const arr: any[] = Array.isArray(parsed) ? parsed
      : (parsed && typeof parsed === "object" ? (Object.values(parsed).find(v => Array.isArray(v)) as any[] | undefined) ?? [] : []);
    const fallbackPage = chunk.pages[0];
    return arr.map(p => normalizePoint(p, fallbackPage)).filter(Boolean) as BatchPoint[];
  }

  /** 编排:取文本 → 分块(10k budget+长文≥3+章节对齐)→ 预估+确认 → map(顺序前文+每块≥1 保底+取消线程)→ reduce 去重 → 生成笔记 → 状态记录。
   *  返回 ExtractResult;count=0 时 message 说明卡在哪一段。 */
  async extract(source: DocumentSource, opts: ExtractOpts = {}): Promise<ExtractResult> {
    const doc = await source.getDocument();
    if (!doc) throw new Error("无法加载 PDF 文档");
    try {
      const file = source.getFile();
      // 1. 每页文本 + 章节边界
      const pages: PageText[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        pages.push({ page: i, text: tc.items.map((it: any) => it.str ?? "").join("") });
      }
      const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
      const chapters = await chapterBoundaries(doc);
      console.log(`[shiyue] 文本:${doc.numPages} 页,${totalChars} 字符;章节边界:${chapters.length ? chapters.join(",") : "(无 outline)"}`);
      // 2. 分块(10k budget + 长文≥3 + 章节对齐)
      const chunks = chunkPages(pages, 10000, 0, chapters);
      console.log(`[shiyue] 分块:${chunks.length} 块`);
      if (chunks.length === 0 || totalChars === 0) {
        return { count: 0, chunks: chunks.length, cancelled: false, message: "PDF 无可抽取文本(可能是扫描件/图片 PDF,pdfjs 取不到文本层)" };
      }
      // 3. 预估 + 确认
      const inputTokens = chunks.reduce((s, c) => s + estimateTokens(c.text) * 1.3, 0);
      const estCost = estimateCost(inputTokens, inputTokens * 0.3, this.pricing);
      if (!(await this.confirmFn(file.basename, chunks.length, Math.round(inputTokens), estCost))) {
        return { count: 0, chunks: chunks.length, cancelled: true, message: "用户取消" };
      }
      opts.onConfirmed?.(chunks.length);  // #4:confirm 通过后 controller 显 loading notice(传总块数)
      // 4. map(每块≥1 保底 + abort 检查)
      let all: BatchPoint[] = [];
      let prior: { title: string; summary: string }[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (opts.signal?.aborted) return { count: all.length, chunks: chunks.length, cancelled: true, message: "用户取消" };
        opts.onProgress?.(i + 1, chunks.length, all.length);  // #4:块开始即显进度(LLM call 期间也见 x/t)
      let pts = await this.extractChunk(file.basename, chunks[i], prior, { signal: opts.signal });
        if (pts.length === 0 && !opts.signal?.aborted) {
          pts = await this.extractChunk(file.basename, chunks[i], prior, { forceAtLeastOne: true, signal: opts.signal });
        }
        if (pts.length === 0 && !opts.signal?.aborted) {
          pts = [synthesizePoint(chunks[i])];
          console.log(`[shiyue] 块 ${i + 1}/${chunks.length} 兜底合成 1 点`);
        }
        console.log(`[shiyue] 块 ${i + 1}/${chunks.length} → ${pts.length} 点`);
        all.push(...pts);
        prior = [...prior, ...pts.map(p => ({ title: p.title, summary: p.summary }))].slice(-30);
        opts.onProgress?.(i + 1, chunks.length, all.length);
      }
      if (opts.signal?.aborted) return { count: 0, chunks: chunks.length, cancelled: true, message: "用户取消" };
      // 5. reduce 去重(标题相似 >0.8 合并)
      const deduped = dedupe(all, 0.8);
      console.log(`[shiyue] 去重:${all.length} → ${deduped.length} 点`);
      // 6. 生成笔记(source_text 用所在页全文——批处理无精确段范围,取页文本作溯源)
      for (const p of deduped) {
        const pageText = pages.find(pg => pg.page === p.source_page)?.text ?? "";
        await this.noteGen.generate({
          title: p.title, summary: p.summary, source_pdf: file.basename, source_page: p.source_page,
          source_text: pageText, tags: p.tags, related: p.related.map(r => r.title), related_reasons: p.related,
          model: this.noteOpts.model, extraction_mode: "batch",
        });
      }
      // 7. 状态记录(避免重复抽 + 增量;state 为 null 则跳过)
      if (this.state) await this.state.record(file.basename, file.path, deduped.map(p => p.title), this.noteOpts.model);
      if (deduped.length === 0) {
        return { count: 0, chunks: chunks.length, cancelled: false,
          message: `LLM 未返回有效知识点(${chunks.length} 块全空——看控制台每块点数)` };
      }
      return { count: deduped.length, chunks: chunks.length, cancelled: false, message: "抽取完成" };
    } finally {
      await doc.destroy?.();
    }
  }
}
