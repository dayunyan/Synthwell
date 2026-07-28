// src/preview/selection-cache.ts
export interface SelInfo { text: string; page: number; }

/** 选区缓存:mouseup 时写,{button / 右键深抽}时读。纯值对象,可单测(零 obsidian 依赖)。
 *  从 selection-capture.ts 拆出(plan-c fix #3):使 SelectionCache 单测可在 node:test 下加载,
 *  而 selection-capture.ts 静态 import Menu from "obsidian"(esbuild bundle,运行时可解析)。 */
export class SelectionCache {
  private sel: SelInfo | null = null;
  get(): SelInfo | null { return this.sel; }
  set(sel: SelInfo): void { this.sel = sel; }
  clear(): void { this.sel = null; }
}
