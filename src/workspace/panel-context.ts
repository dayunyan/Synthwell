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

/** AI 面板上下文(跟踪当前激活 leaf)。纯值持有 + 观察者,与 PreviewTracker 同模式,可单测。 */
export interface PanelContext { file: TFile | null; kind: PanelContextKind; }

export class PanelContextTracker {
  private ctx: PanelContext = { file: null, kind: "none" };
  private listeners = new Set<(c: PanelContext) => void>();

  get(): PanelContext { return this.ctx; }

  set(ctx: PanelContext): void {
    this.ctx = ctx;
    for (const fn of this.listeners) fn(ctx);
  }

  /** 注册监听;立即回调当前值。返回取消订阅。 */
  onChange(fn: (c: PanelContext) => void): () => void {
    this.listeners.add(fn);
    fn(this.ctx);
    return () => { this.listeners.delete(fn); };
  }
}
