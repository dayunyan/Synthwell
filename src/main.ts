// src/main.ts
import { Plugin } from "obsidian";
import { ShiyueSettings, DEFAULT_SETTINGS } from "./settings";
import { ShiyueSettingTab } from "./settings-tab";
import { UsageTracker } from "./core/llm/usage";
import { ShiyueWorkspace } from "./workspace/shiyue-workspace";
import { AiPanelView, SHIYUE_AI_PANEL_VIEW } from "./workspace/ai-panel-view";
import { registerFileMenu } from "./workspace/file-menu";

export default class ShiyuePlugin extends Plugin {
  settings: ShiyueSettings = DEFAULT_SETTINGS;
  private workspace!: ShiyueWorkspace;

  async onload() {
    await this.loadSettings();

    // 先建 workspace:registerView 的 factory 闭包要拿到 this.workspace
    this.workspace = new ShiyueWorkspace(this.app, this, () => this.settings, SHIYUE_AI_PANEL_VIEW);

    this.registerView(SHIYUE_AI_PANEL_VIEW, (leaf) => new AiPanelView(leaf, this.workspace));
    this.workspace.registerLogoInjector();
    registerFileMenu(this, this.workspace);

    this.addCommand({
      id: "open-in-shiyue",
      name: "拾阅: 在拾阅中打开 PDF",
      callback: () => { void this.workspace.openInShiyuePicker(); },
    });
    this.addCommand({
      id: "extract-batch",
      name: "拾阅: 抽取整篇知识点(当前预览)",
      checkCallback: (checking) => this.batchCommand(checking),
    });
    this.addCommand({
      id: "extract-selection",
      name: "拾阅: 选区知识点提取(当前预览)",
      checkCallback: (checking) => this.selectionCommand(checking),
    });

    this.addSettingTab(new ShiyueSettingTab(this.app, this, new UsageTracker(this.app.vault.adapter as any)));
  }

  async onunload() {
    this.workspace?.destroy();
    this.app.workspace.detachLeavesOfType(SHIYUE_AI_PANEL_VIEW);
  }

  private batchCommand(checking: boolean): boolean | void {
    if (!this.workspace.getCurrentFile()) return false;
    if (checking) return true;
    void this.workspace.extractBatch();
  }

  private selectionCommand(checking: boolean): boolean | void {
    if (!this.workspace.getCurrentFile() || !this.workspace.getCurrentSelection()) return false;
    if (checking) return true;
    void this.workspace.extractSelection();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
