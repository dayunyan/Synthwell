// src/workspace/shiyue-workspace.ts
import { App, Plugin, TFile, FuzzySuggestModal, Notice } from "obsidian";
import { SelectionCache, type SelInfo } from "../preview/selection-cache.ts";
import { attachSelectionCapture, type SelectionCaptureHandle } from "../preview/selection-capture.ts";
import { PreviewContext } from "./preview-context.ts";
import { PreviewSplit, ShiyuePreviewSplit } from "./preview-split.ts";
import { ExtractionController } from "./extraction-controller.ts";
import { SynthesisController } from "./synthesis-controller.ts";
import type { PanelContext } from "./panel-context.ts";
import { t } from "../i18n/index.ts";
import type { ShiyueSettings } from "../settings.ts";

/** AI 面板调工作区的动作接口(type-only,AiPanelView 引此避免运行时循环)。
 *  未来 Agent 也可实现此接口驱动面板。 */
export interface PanelActions {
  getCurrentFile(): TFile | null;
  getCurrentSelection(): SelInfo | null;
  onFileChange(fn: (f: TFile | null) => void): () => void;
  onContextChange(fn: (c: PanelContext) => void): () => void;
  extractBatch(): Promise<void>;
  extractSelection(): Promise<void>;
  /** 在上方预览区打开任意文件(PDF 或知识点笔记)。复用 openInShiyue:有文档→同 split 新 tab,空→替换。
   *  汇总输出里的 [[笔记]] 链接点击走此(Bug 3:原 native openLinkText 不开在预览区)。 */
  openInPreview(file: TFile): Promise<void>;
  /** 流式汇总:逐帧 onChunk(markdown, sparse);signal 取消静默结束;非 abort 错抛出。 */
  synthesize(file: TFile, onChunk: (markdown: string, sparse: boolean) => void, signal: AbortSignal): Promise<void>;
}

export const SHIYUE_LOGO_ATTR = "data-shiyue-logo";

/** 拾阅工作区:右侧分屏(上原生预览 / 下 AI 面板)+ logo 注入 + file 加载 + 选区捕获接线。
 *  全公开 API,零 monkey-patch;被动 DOM 监听。
 *
 *  「当前预览上下文」单一真相源 = PreviewContext(纯读侧):每次读取从布局结构现派生
 *  {preview-leaf, file, kind},不存 leaf ref → 无陈旧可 staleness(消三轮 bug 同源)。
 *  写侧布局操作(ensure/toggle/openInPreview)委托 PreviewSplit adapter——小 interface 藏大脆性
 *  (duplicateLeaf/createLeafBySplit/createLeafInParent/setActiveLeaf,各反直觉点注于 preview-split.ts)。
 *  本类持 previewSplit 实例,openInShiyue/logo onclick 改委托它;attachPreviewCapture(选区接线,非布局)留本类。
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
  private previewCtx: PreviewContext;
  private previewSplit: PreviewSplit;
  private cache = new SelectionCache();
  private controller: ExtractionController;
  private synthesisController: SynthesisController;
  private captureHandle: SelectionCaptureHandle | null = null;

  constructor(app: App, plugin: Plugin, settings: () => ShiyueSettings, aiViewType: string) {
    this.app = app; this.plugin = plugin; this.settings = settings; this.aiViewType = aiViewType;
    this.controller = new ExtractionController(app, plugin, settings);
    this.synthesisController = new SynthesisController(app, settings);
    this.previewCtx = new PreviewContext(app, plugin, aiViewType);
    this.previewSplit = new ShiyuePreviewSplit(app, this.previewCtx, aiViewType);
  }

  // ---- PanelActions ----
  getCurrentFile(): TFile | null { return this.previewCtx.getFile(); }
  getCurrentSelection(): SelInfo | null { return this.cache.get(); }
  onFileChange(fn: (f: TFile | null) => void): () => void {
    return this.previewCtx.onChange((ctx) => fn(ctx?.file ?? null));
  }
  onContextChange(fn: (c: PanelContext) => void): () => void {
    return this.previewCtx.onChange((ctx) => fn(ctx ?? { file: null, kind: "none" }));
  }
  openInPreview(file: TFile): Promise<void> { return this.openInShiyue(file); }
  synthesize(file: TFile, onChunk: (markdown: string, sparse: boolean) => void, signal: AbortSignal): Promise<void> {
    return this.synthesisController.synthesize(file, onChunk, signal);
  }

  async extractBatch(): Promise<void> {
    const file = this.previewCtx.getFile();
    if (!file || file.extension !== "pdf") { new Notice(t("notice.noPdf")); return; }
    await this.controller.extractBatch(file);
  }

  async extractSelection(): Promise<void> {
    const file = this.previewCtx.getFile();
    if (!file || file.extension !== "pdf") { new Notice(t("notice.noPdf")); return; }
    const sel = this.cache.get();
    if (!sel) { new Notice(t("notice.selectText"), 4000); return; }
    this.captureHandle?.setExtracting(true);   // 深抽进行中:藏浮按钮,不重复触发
    try { await this.controller.extractSelection(file, sel); }
    finally { this.captureHandle?.setExtracting(false); }
  }

  // ---- 分屏(布局委托 PreviewSplit adapter;选区接线留本类)----
  /** logo 点击:toggle 右侧两屏。布局(收起/ensure)委托 previewSplit.toggle();
   *  收起前先摘选区捕获(document 级 pointerdown 监听 + 浮按钮——选区接线,非布局,留本类)防泄漏。
   *  ensure 分支 captureHandle 本为 null(全关时已清)→ ?. no-op。 */
  async toggleShiyueSplit(): Promise<void> {
    this.captureHandle?.detach();
    this.captureHandle = null;
    await this.previewSplit.toggle();
  }

  // ---- 加载文件 ----
  /** 确保 split + 打开 file(布局:previewSplit.openInPreview——hasDoc?createLeafInParent 新 tab:替换 + openFile)。
   *  布局完成后挂选区捕获(读 previewCtx.getPreviewLeaf() 取 target——非布局,留本类)。 */
  async openInShiyue(file: TFile): Promise<void> {
    await this.previewSplit.openInPreview(file);
    this.attachPreviewCapture();  // view 换了,重挂(leaf 来源现派生:新 tab 已激活 → 派生取到 target)
  }

  /** 给 preview leaf 的 contentEl 挂 mouseup(→cache + 浮「深读」按钮)+ pointerdown(藏按钮)。
   *  leaf 来源 previewCtx.getPreviewLeaf() 现派生(openInPreview 后新 tab 即激活,派生取到它)。 */
  private attachPreviewCapture(): void {
    this.captureHandle?.detach();
    this.captureHandle = null;
    const leaf = this.previewCtx.getPreviewLeaf();
    // leaf.view 是 View(只有 containerEl);原生 PDF view 是 ItemView 子类,运行时有 contentEl
    const view = leaf?.view as (import("obsidian").View & { contentEl?: HTMLElement }) | null;
    const root = view?.contentEl ?? view?.containerEl ?? null;
    if (!root || !leaf) return;
    this.captureHandle = attachSelectionCapture(leaf, this.cache, {
      onDeepExtract: () => { void this.extractSelection(); },
    });
  }

  // ---- logo 注入(被动 DOM,在 graph view contentEl 右上角加 📖)----
  /** 注册 layout-change 监听(logo 注入)+ previewCtx 的 4 事件(上下文派生)。plugin.registerEvent 管自动 cleanup。 */
  registerLogoInjector(): void {
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.injectLogos()));
    this.injectLogos();
    this.previewCtx.registerEvents();
  }

  private injectLogos(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
      const view = leaf.view as unknown as { containerEl?: HTMLElement; contentEl?: HTMLElement };
      // #2:注入视图头栏 .view-actions(「...」more 按钮所在),prepend 到最左 → 在「...」之左。
      const actions = view?.containerEl?.querySelector?.(".view-actions") as HTMLElement | null;
      if (!actions) continue;  // 无头栏动作区 → 不注入(避免与原生图谱控件重叠)
      if (actions.querySelector(`[${SHIYUE_LOGO_ATTR}]`)) continue;
      const btn = actions.createEl("div", { attr: { [SHIYUE_LOGO_ATTR]: "" }, cls: "shiyue-logo" });
      actions.insertBefore(btn, actions.firstChild);  // prepend → 动作区最左
      btn.setText("📖");
      btn.onclick = () => { void this.toggleShiyueSplit(); };
    }
  }

  // ---- picker ----
  async openInShiyuePicker(): Promise<void> {
    const pdfs = this.app.vault.getFiles().filter((f) => f.extension === "pdf");
    if (pdfs.length === 0) { new Notice(t("notice.noPdfInVault")); return; }
    const picker = new ShiyuePdfPickerModal(this.app, pdfs, (f) => { void this.openInShiyue(f); });
    picker.open();
  }

  /** 卸载时摘监听(main.ts onunload 调)。 */
  destroy(): void { this.captureHandle?.detach(); this.captureHandle = null; }
}

class ShiyuePdfPickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly items: TFile[], private readonly onChoose: (f: TFile) => void) {
    super(app);
    this.setTitle(t("picker.title")).setPlaceholder(t("picker.placeholder"));
  }
  getItems(): TFile[] { return this.items; }
  getItemText(item: TFile): string { return item.basename; }
  onChooseItem(item: TFile): void { this.onChoose(item); }
}
