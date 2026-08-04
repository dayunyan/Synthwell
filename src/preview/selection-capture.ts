// src/preview/selection-capture.ts
import type { WorkspaceLeaf } from "obsidian";
import type { SelectionCache } from "./selection-cache.ts";
import { computeFloatPosition, FloatVisibility } from "./selection-float.ts";
import { t } from "../i18n/index.ts";

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

/** attachSelectionCapture 返回的句柄:detach 摘监听+移除浮按钮;setExtracting 协同深抽进行中隐藏。 */
export interface SelectionCaptureHandle {
  detach: () => void;
  setExtracting: (extracting: boolean) => void;
}

/** 给预览 leaf 的 contentEl 挂被动 DOM 监听(零 monkey-patch),选区后浮「深读」按钮就地触发深抽。
 *  - mouseup:window.getSelection 取文本 + findPageNumber 定位页 → cache.set/clear;有选区 → 浮按钮定位显示
 *  - pointerdown(document capture):点别处/开始新选区 → 藏浮按钮(不碰 cache,面板按钮仍可读)
 *  - 浮按钮 click:藏按钮 → onDeepExtract(与 AI 面板「选区知识点提取」同路径 extractSelection)
 *  - setExtracting(深抽进行中):FloatVisibility 闸住,浮按钮隐藏,不重复触发
 *  原生 PDF viewer 右键菜单完整保留:不再 contextmenu preventDefault/stopPropagation(ADR-0004)。
 *
 *  本文件用 DOM API(document/window) + 纯模块 selection-float.ts;obsidian 仅 type-only import。
 *  纯定位/可见性逻辑在 selection-float.ts(node:test 可加载单测);本文件为 DOM 胶水,不直接单测。 */
export function attachSelectionCapture(leaf: WorkspaceLeaf, cache: SelectionCache, opts: AttachOpts = {}): SelectionCaptureHandle {
  const view = leaf.view as (import("obsidian").View & { contentEl?: HTMLElement }) | null;
  const root = view?.contentEl ?? view?.containerEl ?? null;
  if (!root) return { detach: () => {}, setExtracting: () => {} };

  const vis = new FloatVisibility();
  let btn: HTMLButtonElement | null = null;

  const ensureBtn = (): HTMLButtonElement => {
    if (btn) return btn;
    const b = document.body.createEl("button", { cls: "shiyue-float-deepread" });
    b.setText(t("float.deepRead"));
    b.style.visibility = "hidden";   // 藏态仍占布局,offsetWidth 可测
    b.style.pointerEvents = "none";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      hideBtn();
      opts.onDeepExtract?.();
    });
    btn = b;
    return b;
  };
  const hideBtn = (): void => {
    if (btn) { btn.style.visibility = "hidden"; btn.style.pointerEvents = "none"; }
  };
  const showBtn = (): void => {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!range) { hideBtn(); return; }
    const r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { hideBtn(); return; }   // 折叠选区
    // 浮按钮定位到选区【结束】位置(鼠标 mouseup 处),非起点:取 collapse-to-end 的 caret rect
    // (末字符后的插入点位置)→ computeFloatPosition 据此置上/下、左对齐到末点。
    // 退化(零高,某些浏览器对纯文本节点 collapse rect 为空)→ 退到选区 bounding box(旧行为,起点对齐)。
    const endRange = range.cloneRange();
    endRange.collapse(false);   // 折到选区末尾
    const caret = endRange.getBoundingClientRect();
    const src = caret.height > 0 ? caret : r;
    const b = ensureBtn();
    const { left, top } = computeFloatPosition(
      { left: src.left, top: src.top, right: src.right, bottom: src.bottom, width: src.width, height: src.height },
      b.offsetWidth, b.offsetHeight, window.innerWidth, window.innerHeight);
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.style.visibility = "visible";
    b.style.pointerEvents = "auto";
  };
  const refresh = (): void => { if (vis.visible()) showBtn(); else hideBtn(); };

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text) { cache.clear(); vis.setSelection(null); refresh(); return; }
    const anchor = sel?.anchorNode;
    const startEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    const page = findPageNumber(startEl) ?? 1;  // fallback 1
    const info = { text, page };
    cache.set(info);
    vis.setSelection(info);
    refresh();
  };

  // 点浮按钮 → 让 click → onDeepExtract;点预览内(新选区/点击)→ 让 mouseup 处理(避免拖选时闪烁);
  // 点别处(面板/设置等预览外)→ 藏浮按钮(ADR-0004「点别处」消失时机)。不动 cache。
  const onPointerDown = (ev: PointerEvent) => {
    const t = ev.target;
    if (t instanceof Node && btn?.contains(t)) return;
    if (t instanceof Node && root.contains(t)) return;
    hideBtn();
  };

  root.addEventListener("mouseup", onMouseUp);
  document.addEventListener("pointerdown", onPointerDown, true);
  return {
    detach: () => {
      root.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("pointerdown", onPointerDown, true);
      btn?.remove();
      btn = null;
    },
    setExtracting: (extracting: boolean) => { vis.setExtracting(extracting); refresh(); },
  };
}
