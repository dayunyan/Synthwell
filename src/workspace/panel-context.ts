// src/workspace/panel-context.ts
import type { TFile } from "obsidian";

/** AI 面板上下文:由当前激活 leaf 的文件决定面板显什么。
 *  - pdf → 两抽取按钮(现状)
 *  - knowledge-point(md 且 frontmatter shiyue_type=knowledge_point)→ 「汇总关联笔记」按钮
 *  - synthesis(md 且 shiyue_type=synthesis,综合笔记 = 独立图谱节点,ADR-0006)→ 无按钮 +
 *    信息提示「综合笔记 — 汇总自 N 个知识点」(N = synthesized_from 长度)
 *  - none(无文件 / 普通 md / 其它)→ 禁用占位
 *  R1 被动观察(active-leaf-change / file-open),零 monkey-patch(CONTEXT「R1 vs R2」)。 */
export type PanelContextKind = "pdf" | "knowledge-point" | "synthesis" | "none";

/** 最小文件形状(只需 extension),解耦 TFile,纯函数可单测。TFile 结构上满足它。 */
export interface ContextFile { extension: string; }

/** frontmatter 的知识点标识字段。接受 `shiyue_type`(规范键,ADR-0001)与 `synthwell_type`
 *  (改名前遗留键)——dev vault 与早期用户可能有改名前生成的笔记,两者都认,避免误判为 none(Bug 4)。
 *  synthesized_from:综合笔记的源 KP 双链列表(图谱边),#03 信息提示读其长度 = N。 */
export interface ContextFrontmatter {
  shiyue_type?: unknown;
  synthwell_type?: unknown;
  synthesized_from?: unknown;
}

/** 纯分类:文件扩展名 + frontmatter 类型键 → kind。无副作用、可单测。
 *  synthesis 仅认规范键 shiyue_type(综合笔记 ADR-0006 之后才有,改名前不可能生成 → 不认遗留
 *  synthwell_type,与 knowledge_point 的 Bug4 兼容不同源)。synthesis 优先于 knowledge-point
 *  (综合笔记是聚合层,非知识点叶——两者互斥,优先级仅防御两键并存)。 */
export function classifyContext(file: ContextFile | null, fm: ContextFrontmatter | null): PanelContextKind {
  if (!file) return "none";
  if (file.extension === "pdf") return "pdf";
  if (file.extension === "md") {
    if (fm?.shiyue_type === "synthesis") return "synthesis";
    if (fm?.shiyue_type === "knowledge_point" || fm?.synthwell_type === "knowledge_point") return "knowledge-point";
  }
  return "none";
}

/** 综合笔记源知识点数(N = synthesized_from 数组长度,#03 信息提示用)。非数组 / 缺失 → 0(不炸)。
 *  纯函数,可单测;view 读 metadataCache frontmatter 后调此。 */
export function synthesisSourceCount(fm: ContextFrontmatter | null): number {
  return Array.isArray(fm?.synthesized_from) ? fm!.synthesized_from.length : 0;
}

/** AI 面板上下文:{file, kind}。跟踪者已并入 PreviewContext(纯派生 + diff + onChange);
 *  本类型保留供 AiPanelView/onContextChange 复用(PreviewCtx extends PanelContext)。 */
export interface PanelContext { file: TFile | null; kind: PanelContextKind; }
