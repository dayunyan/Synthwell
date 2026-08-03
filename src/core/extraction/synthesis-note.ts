// src/core/extraction/synthesis-note.ts — 综合笔记存为图谱节点的纯逻辑 seam(ADR-0006)。
// 与 renderNote(note-generator.ts)对偶的「另一种笔记 schema」:shiyue_type=synthesis。
// 纯字符串操作、无 Obsidian 依赖(node:test 可加载单测);写侧原子性由 controller 的
// vault.process / vault.create 保证。
//
// 与已废弃的 appendSynthesisSection(追加 ## 综合汇总 章节到知识点笔记)的区别:
// 综合笔记是独立图谱节点(frontmatter synthesized_from 双链 = 图谱边),非埋在知识点内的章节。
// 重汇总 = 全替换(seam 每次产完整内容;controller 覆写同路径文件,bump frontmatter)。
import type { KnowledgeNote } from "./synthesizer.ts";

/** 组综合笔记内容的输入。synthesizedAt 注入(同 renderNote 的 extractedAt 先例)便于单测确定性。 */
export interface BuildSynthesisNoteInput {
  /** 触发知识点标题(正文 H1 用)。 */
  triggerTitle: string;
  /** 源知识点列表(触发 KP + 关联 KP,完整 KnowledgeNote 形以取 title + tags)。 */
  sources: KnowledgeNote[];
  /** Synthesizer 流式输出的综合摘要(带 [[笔记]](pN) 溯源),原样入 body。 */
  synthesisMd: string;
  /** 模型名(溯源,重汇总 bump)。 */
  model: string;
  /** 综合时间(YYYY-MM-DD,与 extracted_at 同格式;注入避免纯 seam 调 Date)。 */
  synthesizedAt: string;
}

/** 综合笔记正文 H1 前缀(固定中文,不随 i18n——存入笔记的持久数据,跨 locale 同形,
 *  与 renderNote 的 `## 原文`/`## 关联` 同模式)。 */
const SYNTH_H1_PREFIX = "# 汇总 - ";

/** 组综合笔记完整内容(frontmatter + body)。
 *  - frontmatter:shiyue_type=synthesis / synthesized_from([[KP]] 双链列表,图谱边) /
 *    synthesized_at / model / tags(源 KP tags 去重并集,供标签面板,非图谱边)。
 *  - body:`# 汇总 - <trigger title>` + synthesisMd 原样(无 ## 原文 / ## 关联 块——那是知识点专属)。
 *  幂等:同输入同输出(重汇总 = controller 覆写同路径,seam 每次产完整内容)。 */
export function buildSynthesisNoteContent(input: BuildSynthesisNoteInput): string {
  const fromLinks = dedupeByTitle(input.sources).map(s => `  - [[${s.title}]]`);
  const tags = dedupeTags(input.sources);

  const lines: string[] = ["---"];
  lines.push("shiyue_type: synthesis");
  lines.push("synthesized_from:");
  if (fromLinks.length) lines.push(...fromLinks); else lines.push("  []");
  lines.push(`synthesized_at: ${input.synthesizedAt}`);
  lines.push(`model: ${input.model}`);
  lines.push("tags:");
  if (tags.length) tags.forEach(tg => lines.push(`  - ${tg}`)); else lines.push("  []");
  lines.push("---", "");

  const body = input.synthesisMd.replace(/\s+$/, "");  // 末尾空白收敛为单换行(与 appendSynthesisSection 同)
  lines.push(SYNTH_H1_PREFIX + input.triggerTitle);
  lines.push("");
  if (body) lines.push(body);
  lines.push("");  // 末换行收尾
  return lines.join("\n");
}

/** 解析综合笔记路径:<synthesisPath>/汇总 - <triggerBasename>.md。
 *  文件名稳定(同 basename → 同路径)→ 重汇总覆盖同文件(bump frontmatter,文件名不变)。
 *  basename 来自 TFile(文件系统已合法),不再 sanitize;仅归一路径斜杠(去尾斜杠、合多斜杠)。 */
export function resolveSynthesisPath(triggerBasename: string, synthesisPath: string): string {
  const dir = synthesisPath.split("/").map(s => s.trim()).filter(Boolean).join("/");
  return `${dir}/汇总 - ${triggerBasename}.md`;
}

/** 源 KP 按标题去重(大小写不敏感,保留首次),保 synthesized_from 无重复双链。 */
function dedupeByTitle(sources: KnowledgeNote[]): KnowledgeNote[] {
  const seen = new Set<string>();
  const out: KnowledgeNote[] = [];
  for (const s of sources) {
    const key = s.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** 全部源 KP tags 去重并集(大小写不敏感,保留首次出现的原大小写)。
 *  顺序:按源列表顺序,每源内按 tags 数组顺序。供标签面板/过滤,非图谱边(分层靠 synthesized_from)。 */
function dedupeTags(sources: KnowledgeNote[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sources) {
    for (const tg of s.tags) {
      const key = tg.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(tg);
    }
  }
  return out;
}
