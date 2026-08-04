// src/workspace/preview-context.ts
import type { App, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { classifyContext, type ContextFrontmatter, type PanelContext, type PanelContextKind } from "./panel-context.ts";

/** 派生结果:预览 leaf + 其文件 + kind。结构走通 → 有 leaf(file 可能 null、kind 可能 none);
 *  走不通 → 整体 null(无 last-known-good,纯派生不造假 leaf)。extends PanelContext 故可直喂 onContextChange。 */
export interface PreviewCtx extends PanelContext {
  leaf: WorkspaceLeaf;
}

/** 运行时形状:WorkspaceParent 有 children、WorkspaceTabs 有 currentTab —— obsidian.d.ts 未暴露,走 cast(同 leafOfFile 先例)。 */
interface ParentLike { parent?: unknown; children?: unknown; currentTab?: unknown; }

function parentOf(item: unknown): ParentLike | null {
  return (item as ParentLike | null | undefined)?.parent ?? null;
}
function childrenOf(parent: unknown): unknown[] | null {
  const c = (parent as ParentLike | null | undefined)?.children;
  return Array.isArray(c) ? c : null;
}
/** 取 tab 组当前 leaf:currentTab 索引(越界/未设 → 末 leaf,即新建 tab 即活跃的常见路径)。 */
function currentLeafOf(tabs: ParentLike, leaves: unknown[]): unknown | null {
  const n = leaves.length;
  const i = typeof tabs.currentTab === "number" && tabs.currentTab >= 0 && tabs.currentTab < n
    ? tabs.currentTab
    : n - 1;
  return leaves[i] ?? null;
}
function leafToFile(leaf: unknown): TFile | null {
  const v = (leaf as { view?: { file?: TFile } } | null | undefined)?.view;
  return v?.file ?? null;
}

/** 纯派生:从 AI 面板 leaf 走布局结构找预览 leaf + 其文件 + kind。不存 ref → 无陈旧可 staleness。
 *
 *  结构链:aiLeaf → .parent(aiTabs) → .parent(右栏 Split) → .children → 非-ai 子(preview Tabs)
 *  → .children[currentTab]。每步防御 null;走不通 → 返 null。
 *  kind 复用 classifyContext(pdf / knowledge-point / none;认遗留 synthwell_type,ADR-Bug4)。
 *  纯函数,可注入 fake aiLeaf/结构 + fmOf 单测(先例:classifyContext、BatchExtractor 注 mock)。 */
export function derivePreviewContext(
  aiLeaf: WorkspaceLeaf | null,
  fmOf: (f: TFile) => ContextFrontmatter | null,
): PreviewCtx | null {
  if (!aiLeaf) return null;
  const aiTabs = parentOf(aiLeaf);              // WorkspaceTabs(tab 组)
  if (!aiTabs) return null;
  const split = parentOf(aiTabs);               // WorkspaceSplit(右栏)
  if (!split) return null;
  const splitChildren = childrenOf(split);
  if (!splitChildren) return null;
  const previewTabs = splitChildren.find((c) => c !== aiTabs);  // 非-ai 子 = 预览 tab 组
  if (!previewTabs) return null;
  const leaves = childrenOf(previewTabs);
  if (!leaves || leaves.length === 0) return null;
  const leaf = currentLeafOf(previewTabs, leaves);
  if (!leaf) return null;
  const file = leafToFile(leaf);
  const kind: PanelContextKind = file ? classifyContext(file, fmOf(file)) : "none";
  return { leaf: leaf as WorkspaceLeaf, file, kind };
}

/** 上下文相等判据(用于 onChange diff,避免无变化时重渲染):leaf 同且 kind 同 → 等。
 *  leaf 同则 file 同;kind 可因 frontmatter 异步解析(metadataCache.changed)而变,故 kind 须单独比。 */
function ctxEqual(a: PreviewCtx | null, b: PreviewCtx | null): boolean {
  return a?.leaf === b?.leaf && a?.kind === b?.kind;
}

/** 不测的 Obsidian 接线壳:每次读现派生(不存 leaf ref → 无陈旧);4 事件 → 重走 derivePreviewContext → diff → onChange。
 *  写侧(openInPreview/ensure/toggle)留 ShiyueWorkspace,只读本类的 getPreviewLeaf() 取目标 leaf(#2 再深)。 */
export class PreviewContext {
  private app: App;
  private plugin: Plugin;
  private aiViewType: string;
  private last: PreviewCtx | null = null;
  private listeners = new Set<(ctx: PreviewCtx | null) => void>();

  constructor(app: App, plugin: Plugin, aiViewType: string) {
    this.app = app; this.plugin = plugin; this.aiViewType = aiViewType;
  }

  /** frontmatter 取 metadataCache 缓存(同步);shiyue_type 与遗留 synthwell_type 都进 classifyContext。 */
  private fmOf = (f: TFile): ContextFrontmatter | null =>
    this.app.metadataCache.getFileCache(f)?.frontmatter ?? null;

  /** AI 面板 leaf 现派生(不存 → toggle 重建后自动跟新 ref)。无 AI leaf(右栏未开)→ null → 整体 null。 */
  private aiLeaf(): WorkspaceLeaf | null {
    return this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
  }

  private derive(): PreviewCtx | null {
    return derivePreviewContext(this.aiLeaf(), this.fmOf);
  }

  getPreviewLeaf(): WorkspaceLeaf | null { return this.derive()?.leaf ?? null; }
  getFile(): TFile | null { return this.derive()?.file ?? null; }
  getKind(): PanelContextKind { return this.derive()?.kind ?? "none"; }

  /** 注册 4 事件(plugin.registerEvent 管自动 cleanup)+ 立即派生一次。 */
  registerEvents(): void {
    const w = this.app.workspace;
    this.plugin.registerEvent(w.on("active-leaf-change", () => this.recompute()));
    this.plugin.registerEvent(w.on("file-open", () => this.recompute()));
    this.plugin.registerEvent(w.on("layout-change", () => this.recompute()));
    // frontmatter 异步解析:刚开笔记时 kind 可能误判 none(metadataCache 尚未缓存 frontmatter);
    // 任意文件 metadata 就绪后重算——recompute 自 diff,无关文件的变更派生等价于 last → 不 fire,无噪声。
    // 不用 `last?.file === f` 守卫:last 是上次派生的缓存,与「现派生的预览文件」偶发错位时会漏掉
    // 正是此事件要修的 kind none→knowledge-point 重算(决策 4)。无条件重算,靠 diff 去噪。
    this.plugin.registerEvent(this.app.metadataCache.on("changed", () => this.recompute()));
    this.recompute();
  }

  /** 重走派生 → diff → 有变才 fire onChange(防无变化重渲染)。 */
  private recompute(): void {
    const cur = this.derive();
    if (ctxEqual(cur, this.last)) return;
    this.last = cur;
    for (const fn of this.listeners) fn(cur);
  }

  /** 注册监听;立即回调当前派生(null = 无预览 leaf)。返回取消订阅。 */
  onChange(fn: (ctx: PreviewCtx | null) => void): () => void {
    this.listeners.add(fn);
    fn(this.last);
    return () => { this.listeners.delete(fn); };
  }
}
