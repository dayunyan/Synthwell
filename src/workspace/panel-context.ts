// src/workspace/panel-context.ts
import type { TFile } from "obsidian";

/** AI 面板上下文:由当前激活 leaf 的文件决定面板显什么。
 *  - pdf → 两抽取按钮(现状)
 *  - knowledge-point(md 且 frontmatter shiyue_type=knowledge_point)→ 「汇总这个知识点」按钮
 *  - none(无文件 / 普通 md / 其它)→ 禁用占位
 *  R1 被动观察(active-leaf-change / file-open),零 monkey-patch(CONTEXT「R1 vs R2」)。 */
export type PanelContextKind = "pdf" | "knowledge-point" | "none";

/** 最小文件形状(只需 extension),解耦 TFile,纯函数可单测。TFile 结构上满足它。 */
export interface ContextFile { extension: string; }

/** frontmatter 的知识点标识字段。接受 `shiyue_type`(规范键,ADR-0001)与 `synthwell_type`
 *  (改名前遗留键)——dev vault 与早期用户可能有改名前生成的笔记,两者都认,避免误判为 none(Bug 4)。 */
export interface ContextFrontmatter { shiyue_type?: unknown; synthwell_type?: unknown; }

/** 纯分类:文件扩展名 + frontmatter 知识点标识键 → kind。无副作用、可单测。
 *  认 shiyue_type 或遗留的 synthwell_type(任一为 knowledge_point 即是知识点笔记)。 */
export function classifyContext(file: ContextFile | null, fm: ContextFrontmatter | null): PanelContextKind {
  if (!file) return "none";
  if (file.extension === "pdf") return "pdf";
  if (file.extension === "md" && (fm?.shiyue_type === "knowledge_point" || fm?.synthwell_type === "knowledge_point")) return "knowledge-point";
  return "none";
}

/** AI 面板上下文:{file, kind}。跟踪者已并入 PreviewContext(纯派生 + diff + onChange);
 *  本类型保留供 AiPanelView/onContextChange 复用(PreviewCtx extends PanelContext)。 */
export interface PanelContext { file: TFile | null; kind: PanelContextKind; }
