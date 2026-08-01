// src/workspace/shiyue-workspace.ts
import { App, Plugin, TFile, FuzzySuggestModal, Notice, WorkspaceLeaf } from "obsidian";
import { SelectionCache, type SelInfo } from "../preview/selection-cache.ts";
import { attachSelectionCapture, type SelectionCaptureHandle } from "../preview/selection-capture.ts";
import { PreviewTracker } from "./preview-tracker.ts";
import { ExtractionController } from "./extraction-controller.ts";
import { SynthesisController } from "./synthesis-controller.ts";
import { PanelContextTracker, classifyContext, type PanelContext } from "./panel-context.ts";
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
  private synthesisController: SynthesisController;
  private panelCtx = new PanelContextTracker();
  private activeFile: TFile | null = null;  // 最近一个非 AI 面板 leaf 的文件(驱动上下文切换)
  private previewLeaf: WorkspaceLeaf | null = null;
  private aiLeaf: WorkspaceLeaf | null = null;
  private captureHandle: SelectionCaptureHandle | null = null;

  constructor(app: App, plugin: Plugin, settings: () => ShiyueSettings, aiViewType: string) {
    this.app = app; this.plugin = plugin; this.settings = settings; this.aiViewType = aiViewType;
    this.controller = new ExtractionController(app, plugin, settings);
    this.synthesisController = new SynthesisController(app, settings);
    // preview 文件变化(打开 PDF)也驱动上下文重算(回退到 PDF 抽取态)
    this.tracker.onChange(() => this.recomputeContext());
  }

  // ---- PanelActions ----
  getCurrentFile(): TFile | null { return this.tracker.get(); }
  getCurrentSelection(): SelInfo | null { return this.cache.get(); }
  onFileChange(fn: (f: TFile | null) => void): () => void { return this.tracker.onChange(fn); }
  onContextChange(fn: (c: PanelContext) => void): () => void { return this.panelCtx.onChange(fn); }
  openInPreview(file: TFile): Promise<void> { return this.openInShiyue(file); }
  synthesize(file: TFile, onChunk: (markdown: string, sparse: boolean) => void, signal: AbortSignal): Promise<void> {
    return this.synthesisController.synthesize(file, onChunk, signal);
  }

  async extractBatch(): Promise<void> {
    const file = this.tracker.get();
    if (!file || file.extension !== "pdf") { new Notice(t("notice.noPdf")); return; }
    await this.controller.extractBatch(file);
  }

  async extractSelection(): Promise<void> {
    const file = this.tracker.get();
    if (!file || file.extension !== "pdf") { new Notice(t("notice.noPdf")); return; }
    const sel = this.cache.get();
    if (!sel) { new Notice(t("notice.selectText"), 4000); return; }
    this.captureHandle?.setExtracting(true);   // 深抽进行中:藏浮按钮,不重复触发
    try { await this.controller.extractSelection(file, sel); }
    finally { this.captureHandle?.setExtracting(false); }
  }

  // ---- 分屏 ----
  /** 确保右侧分屏存在(上 preview / 下 ai)。幂等:已存在则聚焦,preview 失效则重建。
   *  不 toggle——纯 "ensure exists"。logo 点击走 toggleShiyueSplit。 */
  async ensureShiyueSplit(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    if (existingAi) {
      this.aiLeaf = existingAi;
      await this.app.workspace.setActiveLeaf(existingAi, { focus: true });
      if (!this.isPreviewLeafValid()) {
        // preview 真被关(detach,containerEl 已断):在 ai 上方(horizontal split, before=true)重建。
        // 空/刚建预览 leaf 仍存活 → 不重建 → openInShiyue 走替换路径(Bug 3 修复)。
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

  /** logo 点击:toggle 右侧两屏。已存在 → 收起(detach 预览 + AI leaf);不存在 → ensure。
   *  收起后 layout-change 会让 syncPreviewValidity 复查;这里同步清 tracker 让按钮立即禁用。 */
  async toggleShiyueSplit(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    if (existingAi || this.isPreviewLeafValid()) {
      // 收起右栏整体
      this.captureHandle?.detach();
      this.captureHandle = null;
      this.previewLeaf?.detach();
      existingAi?.detach();
      this.previewLeaf = null;
      this.aiLeaf = null;
      this.tracker.set(null);  // 立即禁用 AI 面板按钮(下一次 layout-change 也会复查)
      return;
    }
    await this.ensureShiyueSplit();
  }

  /** preview leaf 是否仍存活在工作区 DOM 中。
   *
   *  用 `view.containerEl.isConnected` 而非 `getLeavesOfType('pdf').includes`:
   *  后者对**空 / 刚建**预览 leaf(尚无文件,非 'pdf' view 类型)返 false →
   *  `ensureShiyueSplit` 每次走 recreate 分支堆叠新 leaf(Bug 1+3 同根因)。
   *  containerEl 在 leaf detach 后会被移出 DOM → isConnected=false;空 leaf 仍连着 → true。
   *  (本版本 obsidian 无 Workspace.getLeaves();leaf存活检查走 DOM 连通性。) */
  private isPreviewLeafValid(): boolean {
    return !!this.previewLeaf && !!this.previewLeaf.view?.containerEl?.isConnected;
  }

  // ---- 加载文件 ----
  /** 确保 split + 打开 file。preview 有文件 → 同 split 新 tab;preview 空 → 替换。(#3) */
  async openInShiyue(file: TFile): Promise<void> {
    await this.ensureShiyueSplit();
    const preview = this.previewLeaf;
    if (!preview) { new Notice(t("notice.cantCreatePreview")); return; }
    const hasDoc = !!this.tracker.get() && this.isPreviewLeafValid();
    let target: WorkspaceLeaf;
    if (hasDoc) {
      // 同 split 新 tab:duplicateLeaf(leaf, "tab") 在 leaf 的 tab 组内复制为一个新 tab
      // (obsidian.d.ts duplicateLeaf 的 leafType='tab' 重载,非 deprecated,自 1.1.0)。
      // 关键:duplicateLeaf 按【激活 leaf】而非源 leaf 定位新 tab——ensureShiyueSplit 刚 setActiveLeaf(AI, focus),
      // 若不先切回 preview,新 tab 会落进 AI 的 tab 组(下方)而非 preview 的(上方)(Bug 1)。
      // 故 dup 前先把 preview 设为激活 leaf。副作用:duplicateLeaf 会先复制 preview 当前 PDF 视图,
      // 随即 openFile 切到新文件 → 旧 transport 被 destroy(pdfjs 控制台 noise,无害,#1 仍正常渲染——已验)。
      await this.app.workspace.setActiveLeaf(preview, { focus: false });
      target = await this.app.workspace.duplicateLeaf(preview, "tab");
    } else {
      target = preview;  // 空 → 替换
    }
    await target.openFile(file);
    this.previewLeaf = target;  // 跟踪最新激活 leaf
    this.attachPreviewCapture();  // view 换了,重挂
    this.tracker.set(file);
  }

  /** 给 preview leaf 的 contentEl 挂 mouseup(→cache + 浮「深读」按钮)+ pointerdown(藏按钮)。 */
  private attachPreviewCapture(): void {
    this.captureHandle?.detach();
    this.captureHandle = null;
    const leaf = this.previewLeaf;
    // leaf.view 是 View(只有 containerEl);原生 PDF view 是 ItemView 子类,运行时有 contentEl
    const view = leaf?.view as (import("obsidian").View & { contentEl?: HTMLElement }) | null;
    const root = view?.contentEl ?? view?.containerEl ?? null;
    if (!root) return;
    this.captureHandle = attachSelectionCapture(leaf!, this.cache, {
      onDeepExtract: () => { void this.extractSelection(); },
    });
  }

  // ---- logo 注入(被动 DOM,在 graph view contentEl 右上角加 📖)----
  /** 注册 layout-change 监听 + 立即扫一次。plugin.registerEvent 管自动 cleanup。 */
  registerLogoInjector(): void {
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => { this.injectLogos(); this.syncPreviewValidity(); }));
    this.injectLogos();
    this.syncPreviewValidity();
    this.registerPanelContextTracking();
  }

  /** R1 被动观察 active-leaf-change / file-open → 重算面板上下文(知识点笔记→汇总;PDF→抽取;否则禁用)。
   *  零 monkey-patch。frontmatter 取 metadataCache 缓存(同步)。 */
  private registerPanelContextTracking(): void {
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (!leaf) { this.recomputeContext(); return; }
      const vt = leaf.view?.getViewType?.();
      if (vt === this.aiViewType) return;  // AI 面板自激活不改上下文,保留按钮启用
      const f = leafOfFile(leaf);
      if (f !== undefined) this.activeFile = f;
      // 跟踪激活的文件 leaf(PDF 或 markdown 笔记)为 previewLeaf。原只跟 PDF → native 打开的笔记
      // 不更新 previewLeaf → previewLeaf 指向陈旧空 leaf → openInShiyue REPLACE 落进陈旧 leaf →
      // Obsidian 新建窗打开(Bug 3b 链接跳转 / Bug1-#2 笔记在预览时 open in shiyue)。markdown 也跟。
      // 仅 shiyue split 存在时跟(用户在工作区上下文);主编辑器随机笔记不抢 previewLeaf。
      const splitOpen = this.app.workspace.getLeavesOfType(this.aiViewType).length > 0;
      if (splitOpen && (vt === "pdf" || vt === "markdown")) {
        this.previewLeaf = leaf;
        this.tracker.set(f ?? null);
        if (vt === "pdf") this.attachPreviewCapture();  // 浮按钮仅 PDF 有意义;md 上挂 mouseup 无害但无浮按钮
      }
      this.recomputeContext();
    }));
    this.plugin.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.activeFile = file;
      this.recomputeContext();
    }));
    // frontmatter 异步解析:刚打开的笔记 active-leaf-change 时 frontmatter 可能尚未缓存 →
    // 此处在其 metadata 就绪后重算,确保知识点笔记被正确识别为 knowledge-point。
    this.plugin.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file === this.activeFile) this.recomputeContext();
    }));
    this.recomputeContext();
  }

  /** 上下文优先级:激活 leaf 的知识点笔记 > 激活/预览 PDF > 无。
   *  - 激活知识点笔记 → knowledge-point(面板切汇总按钮)。
   *  - 激活 PDF / 或预览有 PDF(激活在图谱/面板等无文件处时回退)→ pdf(两抽取按钮,现状)。
   *  - 否则 → none(禁用)。
   *  classifyContext 已封装 kind 判定,这里只按 kind 路由(不重复分支判扩展名)。 */
  private recomputeContext(): void {
    const af = this.activeFile;
    if (af) {
      const fm = this.app.metadataCache.getFileCache(af)?.frontmatter ?? null;
      const kind = classifyContext(af, fm);
      if (kind !== "none") { this.panelCtx.set({ file: af, kind }); return; }
    }
    const preview = this.tracker.get();
    if (preview && preview.extension === "pdf") { this.panelCtx.set({ file: preview, kind: "pdf" }); return; }
    this.panelCtx.set({ file: null, kind: "none" });
  }

  /** preview 关闭/失效时清 tracker → AI 面板按钮禁用(#2 round-2)。layout-change 时复查。 */
  private syncPreviewValidity(): void {
    if (this.tracker.get() && !this.isPreviewLeafValid()) this.tracker.set(null);
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

/** 取 leaf 当前打开的文件(FileView.file;PDF/Markdown view 均有)。无文件 → null;leaf 为 null → undefined(表示「不变」)。 */
function leafOfFile(leaf: WorkspaceLeaf | null): TFile | null | undefined {
  if (!leaf) return undefined;
  const v = leaf.view as unknown as { file?: TFile; getViewType?: () => string };
  return v?.file ?? null;
}
