// src/preview/selection-capture.ts
import type { WorkspaceLeaf, Menu } from "obsidian";

export interface SelInfo { text: string; page: number; }

/** 选区缓存:mouseup 时写,{button / 右键深抽}时读。纯值对象,可单测。 */
export class SelectionCache {
  private sel: SelInfo | null = null;
  get(): SelInfo | null { return this.sel; }
  set(sel: SelInfo): void { this.sel = sel; }
  clear(): void { this.sel = null; }
}

/** 从选区锚点向上找页码:遍历祖先取 `dataset.pageNumber`(pdfjs `.page[data-page-number]` 有此属性)。
 *  找不到返回 null(调用方 fallback 1)。DOM 件,人工验(Task 1 已确认选择器)。 */
export function findPageNumber(el: Element | null): number | null {
  let node: Element | null = el;
  while (node) {
    const pn = (node as HTMLElement).dataset?.pageNumber;
    if (pn) { const n = Number(pn); return Number.isFinite(n) ? n : null; }
    node = node.parentElement;
  }
  return null;
}

export interface AttachOpts { onDeepExtract?: () => void; }

/** 给预览 leaf 的 contentEl 挂两个被动 DOM 监听(零 monkey-patch):
 *  - mouseup:window.getSelection 取文本 + findPageNumber 定位页 → cache.set/clear
 *  - contextmenu:有缓存选区时,弹 Obsidian Menu「深抽这个知识点」→ onDeepExtract
 *  返回 cleanup(摘除两个 listener)。
 *
 *  注:`obsidian` 包是纯类型(`main: ""`),运行时不可静态 import——`Menu` 在 contextmenu
 *  回调里动态 `await import("obsidian")` 取(同 document-source.ts 对 pdfjs 的处理),
 *  使本模块顶层零运行时 obsidian 依赖,SelectionCache 单测可在 node:test 下加载。 */
export function attachSelectionCapture(leaf: WorkspaceLeaf, cache: SelectionCache, opts: AttachOpts = {}): () => void {
  // `leaf.view` 是 `View`(只有 `containerEl`);但原生 PDF view 是 ItemView 子类,运行时有 `contentEl`
  // (Task 1 已验 `[data-page-number]` 在 contentEl 内)。这里 cast 取 contentEl,找不到退 containerEl。
  const view = leaf.view as (import("obsidian").View & { contentEl?: HTMLElement }) | null;
  const root = view?.contentEl ?? view?.containerEl ?? null;
  if (!root) return () => {};

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text) { cache.clear(); return; }
    const anchor = sel?.anchorNode;
    const startEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    const page = findPageNumber(startEl) ?? 1;  // fallback 1(Task 1 不成立时)
    cache.set({ text, page });
  };

  const onContextMenu = async (ev: MouseEvent) => {
    const sel = cache.get();
    if (!sel || !opts.onDeepExtract) return;  // 无选区/无回调 → 让原生菜单通过
    ev.preventDefault();
    ev.stopPropagation();
    const { Menu: ObsMenu } = await import("obsidian");
    const menu = new ObsMenu();
    menu.addItem((i) => i.setTitle("深抽这个知识点").onClick(() => opts.onDeepExtract!()));
    menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
  };

  root.addEventListener("mouseup", onMouseUp);
  root.addEventListener("contextmenu", onContextMenu);
  return () => {
    root.removeEventListener("mouseup", onMouseUp);
    root.removeEventListener("contextmenu", onContextMenu);
  };
}

// 引 Menu 类型避免 unused(实际 new Menu() 在 contextmenu 回调里动态 import 取)。保留 type 供未来扩展。
export type { Menu };
