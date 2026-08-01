// src/workspace/shiyue-workspace.ts
import { App, Plugin, TFile, FuzzySuggestModal, Notice, WorkspaceLeaf } from "obsidian";
import { SelectionCache, type SelInfo } from "../preview/selection-cache.ts";
import { attachSelectionCapture, type SelectionCaptureHandle } from "../preview/selection-capture.ts";
import { PreviewContext } from "./preview-context.ts";
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
 *  写操作(ensure/toggle/openInShiyue/attachCapture)留本类;读 leaf 改走 previewCtx.getPreviewLeaf()。
 *  写侧 adapter(duplicateLeaf/createLeafBySplit 收进小 interface)留 #2。
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
  private cache = new SelectionCache();
  private controller: ExtractionController;
  private synthesisController: SynthesisController;
  private captureHandle: SelectionCaptureHandle | null = null;

  constructor(app: App, plugin: Plugin, settings: () => ShiyueSettings, aiViewType: string) {
    this.app = app; this.plugin = plugin; this.settings = settings; this.aiViewType = aiViewType;
    this.controller = new ExtractionController(app, plugin, settings);
    this.synthesisController = new SynthesisController(app, settings);
    this.previewCtx = new PreviewContext(app, plugin, aiViewType);
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

  // ---- 分屏 ----
  /** 确保右侧分屏存在(上 preview / 下 ai)。幂等:已存在则聚焦,preview 失效则重建。
   *  不 toggle——纯 "ensure exists"。logo 点击走 toggleShiyueSplit。
   *  preview 是否仍存活由 previewCtx.getPreviewLeaf() 现派生(空/刚建 leaf 仍在结构中 → 不重建;
   *  真被 detach → 走不出 leaf → 重建)。 */
  async ensureShiyueSplit(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    if (existingAi) {
      await this.app.workspace.setActiveLeaf(existingAi, { focus: true });
      if (!this.previewCtx.getPreviewLeaf()) {
        // preview 真被关(结构走不出 leaf):在 ai 上方(horizontal split, before=true)重建。
        this.app.workspace.createLeafBySplit(existingAi, "horizontal", true);
      }
      return;
    }
    // 首次:active leaf(通常是 graph)向右分屏 → preview;再向下分屏 → ai
    const preview = this.app.workspace.getLeaf("split", "vertical") as WorkspaceLeaf;
    await this.app.workspace.setActiveLeaf(preview, { focus: false });
    const ai = this.app.workspace.getLeaf("split", "horizontal") as WorkspaceLeaf;
    await ai.setViewState({ type: this.aiViewType, state: {} });
    // preview 尚无文件,不挂选区捕获(等 openInShiyue 的 openFile 后 view 稳定再挂)
  }

  /** logo 点击:toggle 右侧两屏。已存在 → 收起(detach 预览 + AI leaf);不存在 → ensure。
   *  收起后 detach 让结构走不出 leaf → previewCtx 派生 null → 下次 layout-change 自动 fire none 禁用面板。 */
  async toggleShiyueSplit(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    const preview = this.previewCtx.getPreviewLeaf();
    if (existingAi || preview) {
      this.captureHandle?.detach();
      this.captureHandle = null;
      preview?.detach();
      existingAi?.detach();
      return;
    }
    await this.ensureShiyueSplit();
  }

  // ---- 加载文件 ----
  /** 确保 split + 打开 file。preview 有文件 → 同 split 新 tab;preview 空 → 替换。(#3) */
  async openInShiyue(file: TFile): Promise<void> {
    await this.ensureShiyueSplit();
    const preview = this.previewCtx.getPreviewLeaf();
    if (!preview) { new Notice(t("notice.cantCreatePreview")); return; }
    const hasDoc = !!this.previewCtx.getFile();
    let target: WorkspaceLeaf;
    if (hasDoc) {
      // 同 split 新 tab:duplicateLeaf(leaf, "tab") 在 leaf 的 tab 组内复制为一个新 tab
      // (obsidian.d.ts duplicateLeaf 的 leafType='tab' 重载,非 deprecated,自 1.1.0)。
      // 关键:duplicateLeaf 按【激活 leaf】而非源 leaf 定位新 tab——ensureShiyueSplit 刚 setActiveLeaf(AI, focus),
      // 若不先切回 preview,新 tab 会落进 AI 的 tab 组(下方)而非 preview 的(上方)(Bug 1)。
      // 故 dup 前先把 preview 设为激活 leaf。副作用:duplicateLeaf 会先复制 preview 当前 PDF 视图,
      // 随即 openFile 切到新文件 → 旧 transport 被 destroy(pdfjs 控制台 noise,无害,#1 仍正常渲染——已验)。
      // dup 后新 tab 即激活 → previewCtx 现派生取到 target;#2 评估 createLeafInParent 替 duplicateLeaf 消 noise。
      await this.app.workspace.setActiveLeaf(preview, { focus: false });
      target = await this.app.workspace.duplicateLeaf(preview, "tab");
    } else {
      target = preview;  // 空 → 替换
    }
    await target.openFile(file);
    this.attachPreviewCapture();  // view 换了,重挂(leaf 来源现派生)
  }

  /** 给 preview leaf 的 contentEl 挂 mouseup(→cache + 浮「深读」按钮)+ pointerdown(藏按钮)。
   *  leaf 来源 previewCtx.getPreviewLeaf() 现派生(openInShiyue dup 后新 tab 即激活,派生取到它)。 */
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
