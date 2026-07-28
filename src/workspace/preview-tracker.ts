// src/workspace/preview-tracker.ts
import type { TFile } from "obsidian";

/** 跟踪当前预览 leaf 打开的文件。openInShiyue 时 set;AI 面板 onChange 启用/禁用按钮。
 *  纯值持有 + 观察者,可单测(不耦合 obsidian leaf 生命周期——leaf 有效性由 ShiyueWorkspace 校验)。 */
export class PreviewTracker {
  private file: TFile | null = null;
  private listeners = new Set<(f: TFile | null) => void>();

  get(): TFile | null { return this.file; }

  set(file: TFile | null): void {
    this.file = file;
    for (const fn of this.listeners) fn(file);
  }

  /** 注册监听;立即回调当前值。返回取消订阅。 */
  onChange(fn: (f: TFile | null) => void): () => void {
    this.listeners.add(fn);
    fn(this.file);
    return () => { this.listeners.delete(fn); };
  }
}
