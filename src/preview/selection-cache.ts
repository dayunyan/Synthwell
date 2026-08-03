// src/preview/selection-cache.ts
export interface SelInfo { text: string; page: number; }

/** 选区缓存:mouseup 时写,{button / 右键深抽}时读。纯值对象,可单测(零 obsidian 依赖)。
 *  从 selection-capture.ts 拆出(plan-c fix #3):使 SelectionCache 单测可在 node:test 下加载,
 *  而 selection-capture.ts 静态 import Menu from "obsidian"(esbuild bundle,运行时可解析)。
 *  #03:onChange 通知(面板「提炼选中要点」按钮 disabled 态随选区有无切换)——set/clear 时 fire。 */
export class SelectionCache {
  private sel: SelInfo | null = null;
  private listeners = new Set<(sel: SelInfo | null) => void>();

  get(): SelInfo | null { return this.sel; }
  set(sel: SelInfo): void { this.sel = sel; this.fire(); }
  clear(): void { this.sel = null; this.fire(); }

  /** 注册监听;立即回调当前值(注册即反映现状)。返回取消订阅。 */
  onChange(fn: (sel: SelInfo | null) => void): () => void {
    this.listeners.add(fn);
    fn(this.sel);
    return () => { this.listeners.delete(fn); };
  }

  private fire(): void {
    for (const fn of this.listeners) fn(this.sel);
  }
}
