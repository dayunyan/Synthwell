// src/workspace/shiyue-workspace.ts
import { App, Plugin, TFile, FuzzySuggestModal, Notice, WorkspaceLeaf } from "obsidian";
import { SelectionCache, SelInfo, attachSelectionCapture } from "../preview/selection-capture.ts";
import { PreviewTracker } from "./preview-tracker.ts";
import { ExtractionController } from "./extraction-controller.ts";
import type { ShiyueSettings } from "../settings.ts";

/** AI 面板调工作区的动作接口(type-only,AiPanelView 引此避免运行时循环)。
 *  未来 Agent 也可实现此接口驱动面板。 */
export interface PanelActions {
  getCurrentFile(): TFile | null;
  getCurrentSelection(): SelInfo | null;
  onFileChange(fn: (f: TFile | null) => void): () => void;
  extractBatch(): Promise<void>;
  extractSelection(): Promise<void>;
}

export const SHIYUE_LOGO_ATTR = "data-shiyue-logo";

/** 拾阅工作区:右侧分屏(上原生预览 / 下 AI 面板)+ logo 注入 + file 加载 + 选区捕获接线。
 *  全公开 API,零 monkey-patch;被动 DOM 监听。
 *
 *  分屏方向(obsidian.d.ts 实测,命名反直觉):
 *   - getLeaf('split','vertical')   → 新 leaf 在当前 active leaf 的【右边】
 *   - getLeaf('split','horizontal') → 新 leaf 在当前 active leaf 的【下边】
 *  故:graph 激活时 → preview = vertical(右)→ setActive → ai = horizontal(下)= 右栏上下分。 */
export class ShiyueWorkspace implements PanelActions {
  private app: App;
  private plugin: Plugin;
  private settings: () => ShiyueSettings;
  private aiViewType: string;
  private tracker = new PreviewTracker();
  private cache = new SelectionCache();
  private controller: ExtractionController;
  private previewLeaf: WorkspaceLeaf | null = null;
  private aiLeaf: WorkspaceLeaf | null = null;
  private detachCapture: (() => void) | null = null;

  constructor(app: App, plugin: Plugin, settings: () => ShiyueSettings, aiViewType: string) {
    this.app = app; this.plugin = plugin; this.settings = settings; this.aiViewType = aiViewType;
    this.controller = new ExtractionController(app, plugin, settings);
  }

  // ---- PanelActions ----
  getCurrentFile(): TFile | null { return this.tracker.get(); }
  getCurrentSelection(): SelInfo | null { return this.cache.get(); }
  onFileChange(fn: (f: TFile | null) => void): () => void { return this.tracker.onChange(fn); }

  async extractBatch(): Promise<void> {
    const file = this.tracker.get();
    if (!file) { new Notice("没有打开的 PDF"); return; }
    await this.controller.extractBatch(file);
  }

  async extractSelection(): Promise<void> {
    const file = this.tracker.get();
    if (!file) { new Notice("没有打开的 PDF"); return; }
    const sel = this.cache.get();
    if (!sel) { new Notice("请先在 PDF 中选中一段文字", 4000); return; }
    await this.controller.extractSelection(file, sel);
  }

  // ---- 分屏 ----
  /** 确保右侧分屏存在(上 preview / 下 ai)。幂等:已存在则聚焦,preview 失效则重建。 */
  async ensureShiyueSplit(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    if (existingAi) {
      this.aiLeaf = existingAi;
      await this.app.workspace.setActiveLeaf(existingAi, { focus: true });
      if (!this.isPreviewLeafValid()) {
        // preview 被关:在 ai 上方(horizontal split, before=true)重建
        this.previewLeaf = this.app.workspace.createLeafBySplit(existingAi, "horizontal", true);
      }
      return;
    }
    // 首次:active leaf(通常是 graph)向右分屏 → previewLeaf;再向下分屏 → aiLeaf
    const preview = this.app.workspace.getLeaf("split", "vertical") as WorkspaceLeaf;
    this.previewLeaf = preview;
    await this.app.workspace.setActiveLeaf(preview, { focus: false });
    const ai = this.app.workspace.getLeaf("split", "horizontal") as WorkspaceLeaf;
    await ai.setViewState({ type: this.aiViewType, state: {} });
    this.aiLeaf = ai;
    // preview 尚无文件,不挂选区捕获(等 openInShiyue 的 openFile 后 view 稳定再挂)
  }

  /** preview 是否仍在工作区(已打开文件时是 'pdf' leaf)。
   *  本版本 obsidian 无 Workspace.getLeaves(),用 getLeavesOfType('pdf') 含不含本 ref 判断。 */
  private isPreviewLeafValid(): boolean {
    return !!this.previewLeaf && this.app.workspace.getLeavesOfType("pdf").includes(this.previewLeaf);
  }

  // ---- 加载文件 ----
  /** 确保 split + 原生预览打开 file + 重挂选区捕获 + tracker.set → 按钮启用。 */
  async openInShiyue(file: TFile): Promise<void> {
    await this.ensureShiyueSplit();
    const leaf = this.previewLeaf;
    if (!leaf) { new Notice("无法创建预览面板"); return; }
    await leaf.openFile(file);  // 走原生 'pdf' 路由
    this.attachPreviewCapture();  // view 换了,重挂
    this.tracker.set(file);
  }

  /** 给 preview leaf 的 contentEl 挂 mouseup(→cache)+ contextmenu(→深抽 Menu)。 */
  private attachPreviewCapture(): void {
    this.detachCapture?.();
    this.detachCapture = null;
    const leaf = this.previewLeaf;
    // leaf.view 是 View(只有 containerEl);原生 PDF view 是 ItemView 子类,运行时有 contentEl
    const view = leaf?.view as (import("obsidian").View & { contentEl?: HTMLElement }) | null;
    const root = view?.contentEl ?? view?.containerEl ?? null;
    if (!root) return;
    this.detachCapture = attachSelectionCapture(leaf!, this.cache, {
      onDeepExtract: () => { void this.extractSelection(); },
    });
  }

  // ---- logo 注入(被动 DOM,在 graph view contentEl 右上角加 📖)----
  /** 注册 layout-change 监听 + 立即扫一次。plugin.registerEvent 管自动 cleanup。 */
  registerLogoInjector(): void {
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.injectLogos()));
    this.injectLogos();
  }

  private injectLogos(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
      const content = (leaf.view as unknown as { contentEl?: HTMLElement }).contentEl;
      if (!content || content.querySelector(`[${SHIYUE_LOGO_ATTR}]`)) continue;
      const btn = content.createEl("div", { attr: { [SHIYUE_LOGO_ATTR]: "" }, cls: "shiyue-logo" });
      btn.setText("📖");
      btn.onclick = () => { void this.ensureShiyueSplit(); };
    }
  }

  // ---- picker ----
  async openInShiyuePicker(): Promise<void> {
    const pdfs = this.app.vault.getFiles().filter((f) => f.extension === "pdf");
    if (pdfs.length === 0) { new Notice("vault 中没有 .pdf 文件"); return; }
    const picker = new ShiyuePdfPickerModal(this.app, pdfs, (f) => { void this.openInShiyue(f); });
    picker.open();
  }

  /** 卸载时摘监听(main.ts onunload 调)。 */
  destroy(): void { this.detachCapture?.(); this.detachCapture = null; }
}

class ShiyuePdfPickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly items: TFile[], private readonly onChoose: (f: TFile) => void) {
    super(app);
    this.setTitle("选择要在拾阅中打开的 PDF").setPlaceholder("搜索文件名…");
  }
  getItems(): TFile[] { return this.items; }
  getItemText(item: TFile): string { return item.basename; }
  onChooseItem(item: TFile): void { this.onChoose(item); }
}
