// src/workspace/ai-panel-view.ts
import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import type { PanelActions } from "./shiyue-workspace.ts";

export const SHIYUE_AI_PANEL_VIEW = "shiyue-ai-panel";

/** 拾阅 AI 面板:两按钮(抽取整篇 / 选区知识点提取)+ 聊天留位。
 *  按钮启用/禁用跟踪预览文件(经 PanelActions.onFileChange)。 */
export class AiPanelView extends ItemView {
  private actions: PanelActions;
  private batchBtn?: HTMLButtonElement;
  private selBtn?: HTMLButtonElement;
  private detachFile: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, actions: PanelActions) {
    super(leaf);
    this.actions = actions;
  }

  getViewType(): string { return SHIYUE_AI_PANEL_VIEW; }
  getDisplayText(): string { return "拾阅 AI 面板"; }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("shiyue-ai-panel");

    const btns = c.createDiv({ cls: "shiyue-ai-actions" });
    this.batchBtn = btns.createEl("button", { text: "抽取整篇知识点" });
    this.selBtn = btns.createEl("button", { text: "选区知识点提取" });

    const onErr = (label: string) => (e: unknown) =>
      new Notice(`${label}:${e instanceof Error ? e.message : String(e)}`, 8000);
    this.batchBtn.onclick = () => { void this.actions.extractBatch().catch(onErr("抽取失败")); };
    this.selBtn.onclick = () => { void this.actions.extractSelection().catch(onErr("深抽失败")); };

    c.createDiv({ cls: "shiyue-ai-chat-placeholder" })
      .createEl("p", { text: "聊天 Agent(待实现)" });

    const sync = (f: TFile | null) => {
      const has = !!f;
      if (this.batchBtn) this.batchBtn.disabled = !has;
      if (this.selBtn) this.selBtn.disabled = !has;  // 有文件即启用;无选区时点击给 Notice
    };
    this.detachFile = this.actions.onFileChange(sync);
  }

  async onClose(): Promise<void> { this.detachFile?.(); this.detachFile = null; }
}
