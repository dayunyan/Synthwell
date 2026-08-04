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

/** 综合笔记名前缀(固定中文 `汇总 - `,不随 i18n——存入笔记/消息双链的持久数据,跨 locale 同形)。
 *  resolveSynthesisPath(存盘文件名)与 synthesisLinkLabel(消息双链标签)共享此约定:
 *  改前缀只改一处,文件名与「已存为综合笔记 [[...]]」消息双链不漂移(消 Shotgun Surgery)。 */
const SYNTH_NAME_PREFIX = "汇总 - ";

/** 综合笔记正文 H1 前缀(`# ` + SYNTH_NAME_PREFIX,与 renderNote 的 `## 原文`/`## 关联` 同模式)。 */
const SYNTH_H1_PREFIX = `# ${SYNTH_NAME_PREFIX}`;

/** 组综合笔记完整内容(frontmatter + body)。
 *  - frontmatter:shiyue_type=synthesis / synthesized_from([[KP]] 双链列表,图谱边) /
 *    synthesized_at / model / tags(源 KP tags 去重并集,供标签面板,非图谱边)。
 *  - body:`# 汇总 - <trigger title>` + synthesisMd 原样(无 ## 原文 / ## 关联 块——那是知识点专属)。
 *  幂等:同输入同输出(重汇总 = controller 覆写同路径,seam 每次产完整内容)。 */
export function buildSynthesisNoteContent(input: BuildSynthesisNoteInput): string {
  // 项须引号包裹成 YAML 双引号标量 `  - "[[title]]"`(与 renderNote 的 related 同模式):
  // 裸 `  - [[title]]` 会被 YAML 解析为嵌套 flow seq [[ "title" ]] → Obsidian Properties
  // 渲成 `[[[title]]]` 纯文本(非可点链接,图谱边也丢)。引号包裹 → string wikilink → 可点 + 图谱边。
  const fromLinks = dedupeByTitle(input.sources).map(s => `  - "[[${escapeYamlScalar(s.title)}]]"`);
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

/** 解析综合笔记路径:<synthesisPath>/<SYNTH_NAME_PREFIX><triggerBasename>.md。
 *  文件名稳定(同 basename → 同路径)→ 重汇总覆盖同文件(bump frontmatter,文件名不变)。
 *  basename 来自 TFile(文件系统已合法),不再 sanitize;仅归一路径斜杠(去尾斜杠、合多斜杠)。 */
export function resolveSynthesisPath(triggerBasename: string, synthesisPath: string): string {
  const dir = synthesisPath.split("/").map(s => s.trim()).filter(Boolean).join("/");
  return `${dir}/${SYNTH_NAME_PREFIX}${triggerBasename}.md`;
}

/** 综合笔记消息双链标签:`<SYNTH_NAME_PREFIX><triggerBasename>`(与 resolveSynthesisPath 文件名同 stem)。
 *  saveSynthesis 用此构造「已存为综合笔记 [[...]]」消息的 link,使消息双链与实际存盘文件名一致
 *  (可点开综合笔记)。文件名格式变更只改 SYNTH_NAME_PREFIX 一处,不触视图(消 spec/视图 Shotgun Surgery)。 */
export function synthesisLinkLabel(triggerBasename: string): string {
  return `${SYNTH_NAME_PREFIX}${triggerBasename}`;
}

/** YAML 双引号标量转义:先转义反斜杠(否则末尾 \ 会吞闭合引号 → frontmatter 解析失败),
 *  再转义双引号为 `\"`,最后换行→空格(单行标量,防标题跨行破坏 YAML)。
 *  与 renderNote(note-generator.ts)的 source_text 转义同思路。 */
function escapeYamlScalar(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
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
