import { Plugin, TFile, FuzzySuggestModal, Notice, Modal } from "obsidian";
import { PdfView, SHIYUE_PDF_VIEW } from "./pdf-view";
import { ShiyueSettings, DEFAULT_SETTINGS } from "./settings";
import { ShiyueSettingTab } from "./settings-tab";
import { UsageTracker } from "./usage";
import { OpenAICompatibleProvider } from "./llm-service";
import { PdfDocumentSource } from "./document-source";
import { NoteGenerator } from "./note-generator";
import { ExtractionState } from "./extraction-state";
import { BatchExtractor } from "./batch-extractor";
import { SelectionExtractor } from "./selection-extractor";
import { pageTextFromItems } from "./highlight";

export default class ShiyuePlugin extends Plugin {
  settings: ShiyueSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(SHIYUE_PDF_VIEW, (leaf) => new PdfView(leaf, this));
    this.registerExtensions(["pdf"], SHIYUE_PDF_VIEW);  // Plan 3 Task 6: 双击 .pdf → 拾阅 view

    this.addCommand({
      id: "open-pdf-in-shiyue",
      name: "拾阅: 打开 PDF",
      callback: () => this.openPdfPicker(),
    });

    this.addCommand({
      id: "extract-knowledge-points",
      name: "拾阅: 抽取整篇知识点(当前打开的 PDF)",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getLeavesOfType(SHIYUE_PDF_VIEW)[0];
        const view = leaf?.view;
        if (!(view instanceof PdfView) || !view.file) return false;  // 需当前有打开的 PDF
        if (checking) return true;
        this.extractCurrentPdf(view).catch((e: unknown) => new Notice(`抽取失败:${e instanceof Error ? e.message : String(e)}`, 8000));
      },
    });

    this.addCommand({
      id: "extract-selection",
      name: "拾阅: 深抽选中知识点(当前打开的 PDF)",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getLeavesOfType(SHIYUE_PDF_VIEW)[0];
        const view = leaf?.view;
        if (!(view instanceof PdfView) || !view.file) return false;
        if (checking) return true;
        this.extractSelection(view).catch((e: unknown) => new Notice(`深抽失败:${e instanceof Error ? e.message : String(e)}`, 8000));
      },
    });

    this.addSettingTab(new ShiyueSettingTab(this.app, this, new UsageTracker(this.app.vault.adapter as any)));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(SHIYUE_PDF_VIEW);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openPdfPicker() {
    const pdfs = this.app.vault.getFiles().filter((f) => f.extension === "pdf");
    if (pdfs.length === 0) {
      new Notice("vault 中没有 .pdf 文件");
      return;
    }
    const picker = new PdfPickerModal(this.app, pdfs, (item) => this.openPdf(item));
    picker.open();
  }

  async openPdf(file: TFile) {
    const leaf = this.app.workspace.getLeaf(true);  // Plan 3 Task 6: 新 tab(E6:当前编辑区新 tab)
    await leaf.openFile(file);  // FileView 路由 → onOpen → setFile
  }

  /** 对当前打开的 PDF 跑批处理抽取:取文本 → 分块 → 预估确认 → map 去重 → 生成笔记。 */
  async extractCurrentPdf(view: PdfView) {
    if (!view.file) { new Notice("没有打开的 PDF"); return; }
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({
      baseURL: this.settings.baseURL, apiKey, model: this.settings.model,
    });
    const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: this.settings.notesPath, model: this.settings.model });
    const pricing = this.settings.pricing.find(p => p.model === this.settings.model) ?? this.settings.pricing[0];
    const state = new ExtractionState(this.app.vault.adapter as any);
    const be = new BatchExtractor(this.app, provider, noteGen, { notesPath: this.settings.notesPath, model: this.settings.model }, pricing, (book, chunks, tokens, cost) => this.confirmCost(book, chunks, tokens, cost), state);
    const source = new PdfDocumentSource(view.file, this.app, this);
    new Notice("抽取中…(大 PDF 可能需要几十秒)", 4000);
    const r = await be.extract(source, { onProgress: (d, t, p) => new Notice(`抽取中 ${d}/${t} → ${p} 点`, 2000) });
    if (r.count > 0) new Notice(`✓ ${r.message}:${r.count} 个知识点(见 ${this.settings.notesPath}/)`, 8000);
    else new Notice(`✗ ${r.message}`, 8000);
  }

  /** 选区即抽:选中段 + 上下文 ±2 页 + 已有笔记标题 → AI 抽单点 → 生成笔记 + 打开。 */
  async extractSelection(view: PdfView) {
    const sel = view.getSelection();
    if (!sel || !sel.text) { new Notice("请先在 PDF 中选中一段文字", 4000); return; }
    if (!view.file) { new Notice("没有打开的 PDF"); return; }
    const doc = view.getDocument();
    if (!doc) { new Notice("PDF 未加载完成"); return; }
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({ baseURL: this.settings.baseURL, apiKey, model: this.settings.model });
    // 上下文:选中页 ±2 页的文本
    const contextPages: string[] = [];
    for (let pg = Math.max(1, sel.page - 2); pg <= Math.min(doc.numPages, sel.page + 2); pg++) {
      const p = await doc.getPage(pg);
      const tc = await p.getTextContent();
      contextPages.push(`第${pg}页:${pageTextFromItems(tc.items.map((it: any) => ({ str: it.str ?? "" })))}`);
    }
    // 已有笔记标题(扫 notesPath 下 .md,限 500)
    const existing = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(this.settings.notesPath) && f.extension === "md")
      .map(f => f.basename).slice(0, 500);
    new Notice("深抽中…", 2000);
    const se = new SelectionExtractor(provider);
    const point = await se.extract(view.file.basename, sel.text, sel.page, contextPages.join("\n"), existing);
    if (!point) { new Notice("未能抽取(模型未返回有效结果)", 4000); return; }
    const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: this.settings.notesPath, model: this.settings.model });
    const path = await noteGen.generate({
      title: point.title, summary: point.summary, source_pdf: view.file.basename, source_page: point.source_page,
      source_text: sel.text, tags: point.tags, related: point.related.map(r => r.title), related_reasons: point.related,
      model: this.settings.model, extraction_mode: "selection",
    });
    new Notice(`✓ 已生成:${point.title}`, 4000);
    const nf = this.app.vault.getAbstractFileByPath(path);
    if (nf instanceof TFile) await this.app.workspace.getLeaf().openFile(nf);  // 自动打开笔记
  }

  /** 预估花费弹窗(Obsidian Modal):点「继续」返回 true,关闭/取消返回 false。 */
  private confirmCost(book: string, chunks: number, tokens: number, cost: number): Promise<boolean> {
    return new Promise(resolve => {
      const m = new Modal(this.app);
      m.titleEl.setText("抽取知识点 — 预估花费");
      m.contentEl.createEl("p", { text: `《${book}》:约 ${chunks} 块 / ${tokens} tokens,预计 ¥${cost.toFixed(3)}。继续?` });
      const btns = m.contentEl.createDiv({ cls: "shiyue-confirm-btns" });
      const yes = btns.createEl("button", { text: "继续" });
      const no = btns.createEl("button", { text: "取消" });
      let settled = false;
      const done = (v: boolean) => { if (settled) return; settled = true; m.close(); resolve(v); };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      m.onClose = () => done(false);  // Esc/点遮罩关闭 = 取消
      m.open();
    });
  }
}

class PdfPickerModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: import("obsidian").App,
    private readonly items: TFile[],
    private readonly onChoose: (item: TFile) => void,
  ) {
    super(app);
    this.setTitle("选择要打开的 PDF").setPlaceholder("搜索文件名…");
  }

  getItems(): TFile[] { return this.items; }
  getItemText(item: TFile): string { return item.basename; }
  onChooseItem(item: TFile): void { this.onChoose(item); }
}
