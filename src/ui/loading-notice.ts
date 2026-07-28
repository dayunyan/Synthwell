// src/ui/loading-notice.ts
import { App, Notice } from "obsidian";

/** 持续 Notice:spinner + 文本 + Stop 按钮。Stop → onCancel(controller.abort)。
 *  new Notice(el, 0) 持续不自动隐;update 改文本。batch 经 onConfirmed 显;selection 直接显。
 *  #5/#8:抽取中持续 loading + 可中途取消。 */
export class LoadingNotice {
  private notice: Notice | null = null;
  private textEl: HTMLElement | null = null;

  constructor(private app: App, private label: string, private onCancel: () => void) {}

  show(text?: string): void {
    if (this.notice) { this.update(text ?? ""); return; }
    const root = document.createElement("div");
    root.className = "shiyue-loading-notice";
    root.createEl("span", { cls: "shiyue-spinner" });
    this.textEl = root.createEl("span", { cls: "shiyue-loading-text", text: `${this.label}${text ? " " + text : ""}` });
    const stop = root.createEl("button", { cls: "shiyue-loading-stop", text: "停止" });
    stop.onclick = () => this.onCancel();
    // Notice 类型只收 string | DocumentFragment(runtime 也收 HTMLElement,但类型不收)→ 包一层 fragment。
    const frag = document.createDocumentFragment();
    frag.appendChild(root);
    this.notice = new Notice(frag, 0);
  }
  update(text: string): void {
    if (this.textEl) this.textEl.setText(`${this.label} ${text}`);
  }
  hide(): void {
    this.notice?.hide();
    this.notice = null;
    this.textEl = null;
  }
}
