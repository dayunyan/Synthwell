// src/workspace/shiyue-workspace.ts
import { App, Plugin, TFile, FuzzySuggestModal, Notice, WorkspaceLeaf } from "obsidian";
import { SelectionCache, type SelInfo } from "../preview/selection-cache.ts";
import { attachSelectionCapture, type SelectionCaptureHandle } from "../preview/selection-capture.ts";
import { PreviewContext } from "./preview-context.ts";
import { PreviewSplit, ShiyuePreviewSplit } from "./preview-split.ts";
import { ExtractionController } from "./extraction-controller.ts";
import { SynthesisController } from "./synthesis-controller.ts";
import { stripWikilink } from "../core/extraction/note-parser.ts";
import type { PanelContext } from "./panel-context.ts";
import { synthesisSourceCount as synthesisSourceCountFm } from "./panel-context.ts";
import { t } from "../i18n/index.ts";
import type { ShiyueSettings } from "../settings.ts";

/** AI 面板调工作区的动作接口(type-only,AiPanelView 引此避免运行时循环)。
 *  未来 Agent 也可实现此接口驱动面板。 */
export interface PanelActions {
  getCurrentFile(): TFile | null;
  getCurrentSelection(): SelInfo | null;
  onFileChange(fn: (f: TFile | null) => void): () => void;
  onContextChange(fn: (c: PanelContext) => void): () => void;
  /** 选区有无变化订阅(#03):反映 SelectionCache 状态——有选区→true。
   *  面板「提炼选中要点」按钮 disabled 态随此切换(无选区灰,不弹 error)。注册即回调当前值。 */
  onSelectionChange(fn: (has: boolean) => void): () => void;
  /** 抽取进行中订阅(#03):深抽(选区提取)进行中→true。面板整排 disabled 防重复触发。
   *  复用 setExtracting 开关(同源信号亦藏浮按钮)。注册即回调当前值。 */
  onExtractingChange(fn: (b: boolean) => void): () => void;
  /** 综合笔记源知识点数 N(#03 信息提示):读 synthesis 笔记 frontmatter synthesized_from 长度。
   *  非 synthesis / 缺失 → 0。纯读 metadataCache(无 IO)。 */
  synthesisSourceCount(file: TFile): number;
  extractBatch(): Promise<void>;
  extractSelection(): Promise<void>;
  /** 在上方预览区打开任意文件(PDF 或知识点笔记)。复用 openInShiyue:有文档→同 split 新 tab,空→替换。
   *  汇总输出里的 [[笔记]] 链接点击走此(Bug 3:原 native openLinkText 不开在预览区)。 */
  openInPreview(file: TFile): Promise<void>;
  /** 流式汇总:逐帧 onChunk(markdown, sparse);signal 取消静默结束;非 abort 错抛出。 */
  synthesize(file: TFile, onChunk: (markdown: string, sparse: boolean) => void, signal: AbortSignal): Promise<void>;
  /** 把综合摘要存为综合笔记(ADR-0006:独立图谱节点 shiyue_type=synthesis,非追加章节)。
   *  传触发知识点 + synthesis;controller 复用 synthesize 时缓存的源 KP 列表组 frontmatter + 原子写(存在覆盖 / 新建)。 */
  saveSynthesisAsNote(trigger: TFile, synthesis: string): Promise<void>;
  /** 综合笔记是否已存在(点「汇总关联笔记」时 lazy 查 → 确认覆盖用)。纯内存查(无 IO)。 */
  synthesisNoteExists(trigger: TFile): boolean;
  /** 溯源页码跳转(#07):开该笔记的源 PDF(读其 frontmatter source_pdf)+ 导航原生 PDF viewer 到第 N 页。
   *  PDF 页码导航 API 运行时探测:有则跳页,无则开到第 1 页 + Notice(不强造,见 ADR-0005)。 */
  openSourcePage(noteFile: TFile, page: number): Promise<void>;
}

export const SHIYUE_LOGO_ATTR = "data-shiyue-logo";

/** 拾阅工作区:右侧分屏(上原生预览 / 下 AI 面板)+ logo 注入 + file 加载 + 选区捕获接线。
 *  全公开 API,零 monkey-patch;被动 DOM 监听。
 *
 *  「当前预览上下文」单一真相源 = PreviewContext(纯读侧):每次读取从布局结构现派生
 *  {preview-leaf, file, kind},不存 leaf ref → 无陈旧可 staleness(消三轮 bug 同源)。
 *  写侧布局操作(ensure/toggle/openInPreview)委托 PreviewSplit adapter——小 interface 藏大脆性
 *  (duplicateLeaf/createLeafBySplit/createLeafInParent/setActiveLeaf,各反直觉点注于 preview-split.ts)。
 *  本类持 previewSplit 实例,openInShiyue/logo onclick 改委托它;syncSelectionCapture(选区接线,非布局,PDF-only)留本类。
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
  /** 当前 capture 挂载的 leaf(同 leaf 不重复挂;切 leaf 才重挂)。null = 未挂。 */
  private captureLeaf: WorkspaceLeaf | null = null;
  /** 深抽进行中(#03):复用浮按钮 setExtracting 同源信号,亦驱动面板整排 disabled。 */
  private extracting = false;
  private extractingListeners = new Set<(b: boolean) => void>();

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
  onSelectionChange(fn: (has: boolean) => void): () => void {
    return this.cache.onChange((sel) => fn(sel !== null));
  }
  onExtractingChange(fn: (b: boolean) => void): () => void {
    this.extractingListeners.add(fn);
    fn(this.extracting);
    return () => { this.extractingListeners.delete(fn); };
  }
  synthesisSourceCount(file: TFile): number {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    return synthesisSourceCountFm(fm);
  }
  openInPreview(file: TFile): Promise<void> { return this.openInShiyue(file); }
  synthesize(file: TFile, onChunk: (markdown: string, sparse: boolean) => void, signal: AbortSignal): Promise<void> {
    return this.synthesisController.synthesize(file, onChunk, signal);
  }
  saveSynthesisAsNote(trigger: TFile, synthesis: string): Promise<void> {
    return this.synthesisController.saveSynthesisAsNote(trigger, synthesis);
  }
  synthesisNoteExists(trigger: TFile): boolean {
    return this.synthesisController.synthesisNoteExists(trigger);
  }
  async openSourcePage(noteFile: TFile, page: number): Promise<void> {
    const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter;
    const src = stripWikilink(String(fm?.source_pdf ?? ""));
    // 不用 getFirstLinkpathDest:source_pdf 书名常与笔记子文件夹同名(拾阅笔记/知识点/<书名>/),
    // Obsidian resolver 命中文件夹(TFolder,非 TFile)→ 返 null →「找不到源 PDF」(#3)。
    // 改显式按 basename + pdf 扩展名扫 vault,精准命中源 PDF 文件,绕开文件夹名碰撞。
    const pdf = src ? (this.app.vault.getFiles().find(f => f.basename === src && f.extension === "pdf") ?? null) : null;
    if (!pdf) {
      new Notice(t("notice.sourcePdfNotFound", { pdf: src || noteFile.basename }), 6000);
      return;
    }
    await this.openInShiyue(pdf);  // 源 PDF 在预览区打开(复用 openInPreview 路径)
    const jumped = await this.navigatePdfToPage(page);
    if (!jumped) new Notice(t("notice.pageJumpUnavailable"), 6000);
  }

  /** 导航当前预览 PDF 到第 page 页(1-based)。运行时探测(ADR-0005):
   *   1. 先试原生 PDF view 的 JS API(setPage/gotoPage/scrollToPage 等,若有则调)。
   *   2. 退到 DOM:pdfjs 渲 `.page[data-page-number]`(findPageNumber 已依赖此结构)→ 等渲染 + scrollIntoView。
   *   3. 目标页 DOM 不出(PDF 懒渲染:远页常不渲染)→ 兜底滚到第 1 页(开页即在视口附近,几乎必渲染)
   *      + 返 false(调用方 Notice「页码跳转暂不可用,已打开第 1 页」——Notice 文案与实际行为一致)。
   *  leaf/view 每轮现派生(openInShiyue 后 view 已稳定,但防御性重取防异步换 leaf 查 stale root)。
   *  不 monkey-patch pdfjs 内部;只用公开 DOM 结构与(若暴露的)view 方法。 */
  private async navigatePdfToPage(page: number): Promise<boolean> {
    if (tryPdfViewApi(this.pdfView(), page)) return true;
    // 目标页 DOM:轮询至多 ~2s 等 `.page[data-page-number]` 出现并滚入。
    for (let i = 0; i < 20; i++) {
      const root = this.pdfRoot();
      const el = root?.querySelector(`[data-page-number="${page}"]`) as HTMLElement | null;
      if (el) { el.scrollIntoView({ block: "start" }); return true; }
      await sleep(100);
    }
    // 兜底:目标页未渲染 → 滚到第 1 页(几乎必渲染),返 false 让调用方 Notice。
    const p1 = this.pdfRoot()?.querySelector(`[data-page-number="1"]`) as HTMLElement | null;
    p1?.scrollIntoView({ block: "start" });
    return false;
  }

  /** 当前预览 PDF view(防御性 cast:PDF view 类型未公开,ADR-0005)。 */
  private pdfView(): Record<string, unknown> | undefined {
    return this.previewCtx.getPreviewLeaf()?.view as Record<string, unknown> | undefined;
  }
  /** 当前预览 PDF 的渲染根(contentEl 优先,退 containerEl)。 */
  private pdfRoot(): HTMLElement | null {
    const v = this.pdfView() as { contentEl?: HTMLElement; containerEl?: HTMLElement } | undefined;
    return v?.contentEl ?? v?.containerEl ?? null;
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
    this.setExtracting(true);   // 深抽进行中:藏浮按钮 + 面板整排 disabled(#03 复用同源信号)
    try { await this.controller.extractSelection(file, sel); }
    finally { this.setExtracting(false); }
  }

  /** 深抽进行中开关(#03):同步浮按钮可见性(setExtracting on captureHandle)与面板整排 disabled
   *  (onExtractingChange 监听)。同值 no-op;变化时 fire 监听。 */
  private setExtracting(b: boolean): void {
    if (this.extracting === b) return;
    this.extracting = b;
    this.captureHandle?.setExtracting(b);
    for (const fn of this.extractingListeners) fn(b);
  }

  // ---- 分屏(布局委托 PreviewSplit adapter;选区接线留本类)----
  /** logo 点击:toggle 右侧两屏。布局(收起/ensure)委托 previewSplit.toggle();
   *  收起前先摘选区捕获(document 级 pointerdown 监听 + 浮按钮——选区接线,非布局,留本类)防泄漏。
   *  ensure 分支 captureHandle 本为 null(全关时已清)→ ?. no-op。 */
  async toggleShiyueSplit(): Promise<void> {
    this.captureHandle?.detach();
    this.captureHandle = null;
    this.captureLeaf = null;
    this.cache.clear();
    await this.previewSplit.toggle();
    this.syncSelectionCapture();   // ensure 后按当前 kind 重挂(开 PDF → 浮按钮挂;非 PDF → 不挂)
  }

  // ---- 加载文件 ----
  /** 确保 split + 打开 file(布局:previewSplit.openInPreview——hasDoc?createLeafInParent 新 tab:替换 + openFile)。
   *  布局完成后同步选区捕获(读 previewCtx.getKind() 取当前 kind——非布局,留本类)。 */
  async openInShiyue(file: TFile): Promise<void> {
    await this.previewSplit.openInPreview(file);
    this.syncSelectionCapture();  // view 换了,按 kind 重挂/摘浮按钮
  }

  /** 选区捕获 + 浮「精读选中」按钮 PDF-only(#03 修复):kind !== "pdf" 不挂(笔记/md 上下文不挂浮按钮,
   *  避免点击失败 notice.noPdf 的脆性);切回 PDF 重挂。同 leaf 已挂则 no-op(避免每次 layout-change 重挂)。
   *  切 leaf 时清 cache(旧选区不再属于新预览,面板按钮须返 disabled)。 */
  private syncSelectionCapture(): void {
    const kind = this.previewCtx.getKind();
    if (kind !== "pdf") {
      this.captureHandle?.detach();
      this.captureHandle = null;
      this.captureLeaf = null;
      this.cache.clear();   // 非 PDF 上下文:旧选区作废(面板按钮不在非 PDF 显,但切回 PDF 前清掉防陈旧)
      return;
    }
    const leaf = this.previewCtx.getPreviewLeaf();
    if (this.captureHandle && this.captureLeaf === leaf) return;  // 同 leaf 已挂 → no-op
    this.captureHandle?.detach();
    this.captureHandle = null;
    this.captureLeaf = leaf;
    this.cache.clear();   // 新 PDF(或切 tab):旧选区不属于此预览,清掉让按钮 disabled
    if (!leaf) return;
    this.captureHandle = attachSelectionCapture(leaf, this.cache, {
      onDeepExtract: () => { void this.extractSelection(); },
    });
  }

  // ---- logo 注入(被动 DOM,在 graph view contentEl 右上角加 📖)----
  /** 注册 layout-change 监听(logo 注入)+ previewCtx 的 4 事件(上下文派生)。plugin.registerEvent 管自动 cleanup。
   *  #03:订阅上下文变化 → syncSelectionCapture(切 PDF→笔记→PDF 时浮按钮正确摘/挂;PDF-only)。 */
  registerLogoInjector(): void {
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.injectLogos()));
    this.injectLogos();
    this.previewCtx.registerEvents();
    this.previewCtx.onChange(() => this.syncSelectionCapture());
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
  destroy(): void {
    this.captureHandle?.detach();
    this.captureHandle = null;
    this.captureLeaf = null;
    this.extractingListeners.clear();
  }
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

// ---- #07 溯源页码跳转辅助 ----

/** 探测原生 PDF view 是否暴露页码导航方法;有则调并返 true。候选方法名取自 Obsidian/pdfjs 常见命名,
 *  运行时按存在性试(adr-0005:PDF view 类型未公开 → 防御性探测,不强造)。 */
function tryPdfViewApi(view: unknown, page: number): boolean {
  if (!view || typeof view !== "object") return false;
  const v = view as Record<string, unknown>;
  for (const m of ["setPage", "gotoPage", "scrollToPage", "setPageNumber"]) {
    const fn = v[m];
    if (typeof fn === "function") { (fn as (p: number) => void).call(v, page); return true; }
  }
  // pdfjs PDFViewer.currentPageNumber setter(若 view 暴露 viewer/pdfViewer)
  const sub = (v.viewer ?? v.pdfViewer) as Record<string, unknown> | undefined;
  if (sub && "currentPageNumber" in sub) {
    try { sub.currentPageNumber = page; return true; } catch { /* setter 不可写 → 退到 DOM */ }
  }
  return false;
}

/** 异步 sleep(导航轮询用;运行时 UI 代码,Date/setTimeout 可用——非 workflow 脚本)。 */
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

