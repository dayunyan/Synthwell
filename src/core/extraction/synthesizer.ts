import type { LLMProvider, ChatMsg } from "../llm/llm-service.ts";
import type { RelatedRef } from "./normalize.ts";
import { t } from "../../i18n/index.ts";

/** 一条知识点笔记的完整形状(关联筛选与综合共用)。
 *  current 与候选笔记同形:都带 tags / related(backlink)/ source_text,筛选与单篇聚合视图都用得到。 */
export interface KnowledgeNote {
  title: string;
  summary: string;
  source_pdf: string;
  source_page: number;
  source_text: string;
  tags: string[];
  related: RelatedRef[];  // 本笔记 frontmatter `related`(backlink 指向,带关联理由)
}

/** 经关联筛选后的关联笔记:reason=关联理由(空=纯 tag 共享,非空=AI 判过的强关联 backlink)。 */
export interface AssociatedNote {
  title: string;
  summary: string;
  source_pdf: string;
  source_page: number;
  source_text: string;
  reason: string;
}

export interface SynthesisInput {
  current: KnowledgeNote;
  associated: AssociatedNote[];
}

export interface SynthesisResult {
  markdown: string;  // 带 [[笔记]](pN) 引用的综合摘要(honest-sparse 时为单篇聚合 + 诚实标注)
  sparse: boolean;   // 关联 ≤1 → true(controller 据此决定是否提示)
}

/** 限 20:大 vault 不把汇总喂爆 token(CONTEXT / spec user story 10)。 */
const DEFAULT_LIMIT = 20;

/** 关联理由:取 current→candidate 的理由,否则 candidate→current 的理由,否则空(纯 tag 共享 或 退化 backlink)。
 *  任一方向的 backlink 带 reason 即视为强关联信号;backlink 命中但理由空 → 仍记为关联(reason 空,不当作强关联)。 */
function reasonFor(cur: KnowledgeNote, cand: KnowledgeNote): string {
  const fwd = cur.related.find(r => sameTitle(r.title, cand.title));
  if (fwd?.reason) return fwd.reason;
  const rev = cand.related.find(r => sameTitle(r.title, cur.title));
  return rev?.reason ?? "";  // backlink 命中但理由空 / 纯 tag 共享 → ""
}

/** 标题比对:trim + 大小写不敏感(CJK 无大小写问题,英文标题容差)。 */
function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 共享 ≥1 标签。 */
function shareTag(cur: KnowledgeNote, cand: KnowledgeNote): boolean {
  if (!cur.tags.length || !cand.tags.length) return false;
  const set = new Set(cur.tags.map(t => t.toLowerCase()));
  return cand.tags.some(t => set.has(t.toLowerCase()));
}

/** backlink 命中:current.related 指向 candidate,或 candidate.related 指向 current。 */
function backlinkHit(cur: KnowledgeNote, cand: KnowledgeNote): boolean {
  return cur.related.some(r => sameTitle(r.title, cand.title))
    || cand.related.some(r => sameTitle(r.title, cur.title));
}

/** 关联筛选(无向量,纯 tag/backlink):共享 ≥1 标签 或 backlink 命中即关联;
 *  >20 截断;强关联(reason 非空)优先排序,同档按 source_page 升序再 title 稳定排序。
 *  不含 current 自身(同名笔记视为自身,排除以防回环)。
 *  返回的 AssociatedNote 带 reason,喂进综合 prompt 让 AI 聚焦强关联(CONTEXT「关联理由」三层用处①②)。 */
export function filterAssociated(cur: KnowledgeNote, candidates: KnowledgeNote[], limit = DEFAULT_LIMIT): AssociatedNote[] {
  const matched: AssociatedNote[] = [];
  for (const cand of candidates) {
    if (sameTitle(cand.title, cur.title)) continue;  // 排除自身
    const linked = backlinkHit(cur, cand);
    if (!linked && !shareTag(cur, cand)) continue;
    const reason = linked ? reasonFor(cur, cand) : "";
    matched.push({
      title: cand.title, summary: cand.summary, source_pdf: cand.source_pdf,
      source_page: cand.source_page, source_text: cand.source_text, reason,
    });
  }
  // 稳定排序:Array.sort 在 Node 稳定。强关联(reason 非空)优先;同档 source_page 升序、title 升序。
  matched.sort((a, b) => {
    const sa = a.reason ? 0 : 1;
    const sb = b.reason ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (a.source_page !== b.source_page) return a.source_page - b.source_page;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
  return matched.slice(0, limit);
}

/** 组综合 prompt:当前知识点 + 各关联笔记 summary + source_text + reason。
 *  reason 喂进去让综合 AI 不必重新推断关系;要求每个事实后用 [[笔记标题]](p页码) 标注来源。
 *  prompt 是给模型的中英混合指令,不随 i18n 改(改语言可能影响质量)。 */
export function buildSynthesisPrompt(input: SynthesisInput): string {
  const c = input.current;
  const lines: string[] = [];
  lines.push("你是知识综合助手。用户打开了一个知识点,请围绕它综合关联的知识点笔记,产出带引用溯源的综合摘要。");
  lines.push(`当前知识点:${c.title}(《${c.source_pdf}》p${c.source_page})`);
  lines.push(`摘要:${c.summary}`);
  lines.push("");
  lines.push("关联知识点(按关联强度排序,带关联理由;强关联优先聚焦):");
  input.associated.forEach((a, i) => {
    lines.push(`${i + 1}. [[${a.title}]](p${a.source_page}) —《${a.source_pdf}》`);
    lines.push(`   摘要:${a.summary}`);
    lines.push(`   原文片段:${a.source_text}`);
    lines.push(`   关联理由:${a.reason || "(纯标签共享)"}`);
  });
  lines.push("");
  lines.push("要求:每个事实后用 [[笔记标题]](p页码) 标注来源。综合时优先聚焦带关联理由的强关联笔记。不要编造未在上述材料中给出的信息。");
  return lines.join("\n");
}

/** honest-sparse 单篇聚合视图(关联 ≤1 时不调 LLM):当前知识点 + 各关联点 summary + 原文片段 + 诚实标注。
 *  不编造、不假承诺:如实标注关联少,随抽取更多文档汇总将跨文档综合(CONTEXT「honest sparse」)。
 *  渲染给用户的 markdown(user-facing)走 i18n;LLM prompt(buildSynthesisPrompt)不走(issue #06)。 */
export function buildSparseMarkdown(input: SynthesisInput): string {
  const c = input.current;
  const lines: string[] = [];
  lines.push(t("synth.sparse.heading", { title: c.title }));
  lines.push("");
  lines.push(t("synth.sparse.warning"));
  lines.push("");
  lines.push(t("synth.sparse.currentHeading"));
  lines.push(t("synth.sparse.currentLine", { title: c.title, pdf: c.source_pdf, page: c.source_page }));
  lines.push(c.summary);
  if (c.source_text) lines.push(t("synth.sparse.excerpt", { text: c.source_text }));
  if (input.associated.length) {
    lines.push("", t("synth.sparse.relatedHeading"));
    for (const a of input.associated) {
      lines.push(`### [[${a.title}]](p${a.source_page})`);
      lines.push(`(《${a.source_pdf}》)`);  // 引用标记(书名号),两语言同形
      lines.push(a.summary);
      lines.push(t("synth.sparse.excerpt", { text: a.source_text }));
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** 汇总(RAG synthesis)纯逻辑核心:给定当前知识点 + 其关联笔记,产出带 [[笔记]](pN) 引用溯源的综合摘要。
 *  - 关联 ≤1(冷启动稀疏)→ 不调 LLM,直接组单篇聚合视图 + sparse:true(省 token、诚实降级)。
 *  - 关联 >1 → 组 prompt(当前知识点 + 各关联笔记 summary + 原文片段 + 关联理由)→ LLM → 返回带引用的摘要。
 *  - 取消:signal.aborted → 不抛、返空 markdown(已组部分由 controller 流式保留;非流式核心无部分可返)。
 *  - 非 abort 错 → 抛出,交 controller 友好提示 + 保留已生成内容(与 SelectionExtractor 同模式)。
 *  与 BatchExtractor / SelectionExtractor 同一注入模式(注入 LLMProvider 端到端测)。 */
export class Synthesizer {
  private llm: LLMProvider;
  constructor(llm: LLMProvider) { this.llm = llm; }

  async synthesize(input: SynthesisInput, signal?: AbortSignal): Promise<SynthesisResult> {
    if (input.associated.length <= 1) {
      return { markdown: buildSparseMarkdown(input), sparse: true };
    }
    // 已取消 → 不调 LLM、返空(不抛)
    if (signal?.aborted) return { markdown: "", sparse: false };
    const prompt = buildSynthesisPrompt(input);
    let raw: string;
    try {
      raw = await this.llm.chat([{ role: "user", content: prompt }] as ChatMsg[], { temperature: 0.3, signal });
    } catch (e) {
      if (signal?.aborted) return { markdown: "", sparse: false };  // 取消 → 不抛、返空
      throw e;  // 其他错抛出(controller 给友好提示 + 保留已生成内容)
    }
    // 引用格式:LLM 返文本里的 [[笔记]](pN) 保留(规范化延后——page 跳转待 R2+)
    return { markdown: raw, sparse: false };
  }

  /** 流式综合(供 #05 面板增量渲染):sparse(关联 ≤1)→ 一次性 yield 单篇聚合视图;
   *  否则用 llm.stream 增量 yield 累积 markdown。取消(signal)→ 停止、不抛,已 yield 部分由调用方保留。
   *  与 synthesize 同样的 sparse 分流与 abort 语义,但走流式让面板逐字渲染。 */
  async *synthesizeStream(input: SynthesisInput, signal?: AbortSignal): AsyncGenerator<SynthesisChunk> {
    if (input.associated.length <= 1) {
      yield { markdown: buildSparseMarkdown(input), sparse: true };
      return;
    }
    if (signal?.aborted) return;  // 已取消 → 不调 LLM、不抛
    const prompt = buildSynthesisPrompt(input);
    let acc = "";
    try {
      for await (const delta of this.llm.stream([{ role: "user", content: prompt }] as ChatMsg[], { temperature: 0.3, signal })) {
        if (signal?.aborted) break;  // 中途取消 → 停止迭代
        acc += delta;
        yield { markdown: acc, sparse: false };
      }
    } catch (e) {
      if (signal?.aborted) return;  // 取消 → 不抛,已 yield 部分保留
      throw e;  // 其他错抛出(controller 给友好提示)
    }
  }
}

/** 流式综合的一帧:累积 markdown + sparse 标志(首帧 sparse=true 时即完整单篇聚合视图)。 */
export interface SynthesisChunk { markdown: string; sparse: boolean; }
