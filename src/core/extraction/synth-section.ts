// src/core/extraction/synth-section.ts — 存回笔记的纯逻辑 seam。
// 把综合摘要 markdown 追加到知识点笔记的 `## 综合汇总` 章节(spec §6「保存(可选)」)。
// 纯字符串操作、无 Obsidian 依赖(node:test 可加载单测);写侧原子性由 vault.process 保证
// (controller 调:vault.process(path, data => appendSynthesisSection(data, synthesis)))。

/** 存回章节的固定标题。笔记存储章节名沿用 note-generator.ts 的固定中文约定
 *  (`## 原文` / `## 关联`),不随 i18n 改——存入笔记的数据是用户跨 locale 持久资产,
 *  固定标题保证 zh/en 用户读到同一章节(与 renderNote 的 `## 原文`/`## 关联` 同模式)。 */
export const SYNTH_SECTION_HEADING = "## 综合汇总";

const HEADING_RE = /^##\s+综合汇总\s*$/;

/** 把 synthesis 追加到 content 的 `## 综合汇总` 章节末尾;章节不存在则于文末创建。
 *
 *  - 章节不存在:文末(必要时补空行隔开)加 `## 综合汇总\n\n<synthesis>\n`。
 *  - 章节已存在:在其内容末尾(下一个 `## ` 标题前 / 文末)追加 synthesis 块,前后留空行。
 *  - synthesis 末尾的换行统一为单 `\n`;空 synthesis 亦可存(AC「空 synthesis 亦可存」)。
 *  幂等性:重复存会累加多块(不覆盖)——与「追加」语义一致;去重不在 v1 范围。 */
export function appendSynthesisSection(content: string, synthesis: string): string {
  const lines = content.split("\n");
  const secIdx = lines.findIndex(l => HEADING_RE.test(l));
  const block = synthesis.replace(/\s+$/, "");  // 末尾空白收敛为单换行

  if (secIdx < 0) {
    return createSectionAtEnd(lines, block);
  }
  return appendWithinSection(lines, secIdx, block);
}

/** 文末创建 `## 综合汇总` 章节:补空行隔开既有内容,再加标题 + 空行 + synthesis + 末换行。 */
function createSectionAtEnd(lines: string[], block: string): string {
  const out = [...lines];
  // 去掉既有尾部多余空行,统一隔开
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  if (out.length > 0) out.push("");  // 与既有内容之间空一行
  out.push(SYNTH_SECTION_HEADING, "", block, "");
  return out.join("\n");
}

/** 章节内追加:找到本章节结束(下一个 `## ` 标题 or 文末),在其前插入 synthesis 块。
 *  插入处保证:本块前有空行(与既有章节内容隔开)、本块后有空行(与下一标题隔开)。 */
function appendWithinSection(lines: string[], secIdx: number, block: string): string {
  // 本章节内容 = lines[secIdx+1 .. end-1],end = 下一 `## ` 标题索引 or lines.length
  let end = secIdx + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;

  const section = lines.slice(secIdx + 1, end);
  // 去掉章节内容尾部空行,便于干净拼接
  while (section.length > 0 && section[section.length - 1] === "") section.pop();

  const rebuilt = [
    ...lines.slice(0, secIdx + 1),  // 到 `## 综合汇总` 含
    ...section,
    "",                              // 与既有内容隔开
    block,
    "",                              // 与下一标题隔开(或文末收尾)
    ...lines.slice(end),
  ];
  return rebuilt.join("\n");
}
