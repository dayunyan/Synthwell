// src/preview/selection-capture.ts
import { Menu } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { SelectionCache } from "./selection-cache.ts";

/** 从选区锚点向上找页码:遍历祖先取 dataset.pageNumber(pdfjs `.page[data-page-number]` 有此属性)。
 *  找不到返回 null(调用方 fallback 1)。 */
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
 *  - contextmenu(capture 阶段):有缓存选区时,弹 Obsidian Menu「深抽这个知识点」→ onDeepExtract
 *  返回 cleanup(摘除两个 listener)。
 *
 *  Menu 用静态 import(非动态 await import):esbuild bundle 时把 "obsidian" 作 external 解析,
 *  运行时 require('obsidian') 可用;动态 import("obsidian") 在 Obsidian 运行时会抛
 *  "Failed to resolve module specifier 'obsidian'"(obsidian 非 ES module)。SelectionCache
 *  拆到独立纯模块,故本文件不被 node:test 加载,可自由静态 import obsidian。 */
export function attachSelectionCapture(leaf: WorkspaceLeaf, cache: SelectionCache, opts: AttachOpts = {}): () => void {
  const view = leaf.view as (import("obsidian").View & { contentEl?: HTMLElement }) | null;
  const root = view?.contentEl ?? view?.containerEl ?? null;
  if (!root) return () => {};

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text) { cache.clear(); return; }
    const anchor = sel?.anchorNode;
    const startEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    const page = findPageNumber(startEl) ?? 1;  // fallback 1
    cache.set({ text, page });
  };

  const onContextMenu = (ev: MouseEvent) => {
    const sel = cache.get();
    if (!sel || !opts.onDeepExtract) return;  // 无选区/无回调 → 让原生菜单通过
    ev.preventDefault();
    ev.stopPropagation();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("深抽这个知识点").onClick(() => opts.onDeepExtract!()));
    menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
  };

  root.addEventListener("mouseup", onMouseUp);
  // capture 阶段:原生 PDF viewer 的 bubble-phase contextmenu 会 stopPropagation 拦截,capture 先触发。
  root.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    root.removeEventListener("mouseup", onMouseUp);
    root.removeEventListener("contextmenu", onContextMenu, true);
  };
}
