// src/preview/selection-float.ts
import type { SelInfo } from "./selection-cache.ts";

/** 选区视口矩形(DOMRect 的子集,便于单测构造)。 */
export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number; }
/** 浮按钮左上角坐标(视口空间,position:fixed 用)。 */
export interface Pt { left: number; top: number; }

/** 浮按钮定位(纯函数,可单测):
 *  优先置于选区正上方(gap 间距);上方空间不足且下方够 → 下方;上下都不够 → 贴选区顶部(不超 viewport)。
 *  left 对齐选区 left,钳制在 [0, viewportW - btnW] 内不溢出。
 *  ADR-0004:定位用选区 getBoundingClientRect,视口空间计算。 */
export function computeFloatPosition(
  selRect: Rect, btnW: number, btnH: number, viewportW: number, viewportH: number, gap = 6,
): Pt {
  const aboveTop = selRect.top - gap - btnH;          // 置上:按钮底贴选区顶上方 gap
  const belowTop = selRect.bottom + gap;             // 置下:按钮顶贴选区底下方 gap
  const fitsBelow = belowTop + btnH <= viewportH;
  const top = aboveTop >= 0
    ? aboveTop
    : (fitsBelow ? belowTop : Math.max(0, selRect.top));
  const left = Math.max(0, Math.min(selRect.left, viewportW - btnW));
  return { left, top };
}

/** 浮按钮可见性闸(纯状态机,可单测):有选区且未在深抽中 → 可见。
 *  深抽进行中(LoadingNotice 显)隐藏,避免重复触发(ADR-0004 协同要点)。 */
export class FloatVisibility {
  private sel: SelInfo | null = null;
  private extracting = false;
  setSelection(s: SelInfo | null): void { this.sel = s; }
  setExtracting(b: boolean): void { this.extracting = b; }
  visible(): boolean { return this.sel !== null && !this.extracting; }
}
