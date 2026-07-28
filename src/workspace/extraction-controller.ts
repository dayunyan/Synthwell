// src/workspace/extraction-controller.ts
import { App, Plugin, TFile, Notice } from "obsidian";
import { OpenAICompatibleProvider } from "../core/llm/llm-service.ts";
import { PdfDocumentSource } from "../core/document/document-source.ts";
import { NoteGenerator } from "../core/extraction/note-generator.ts";
import { ExtractionState } from "../core/extraction/extraction-state.ts";
import { BatchExtractor } from "../core/extraction/batch-extractor.ts";
import { SelectionExtractor } from "../core/extraction/selection-extractor.ts";
import { pageTextFromItems } from "../core/document/pdf-text.ts";
import { confirmCost } from "../ui/confirm-modal.ts";
import { LoadingNotice } from "../ui/loading-notice.ts";
import type { ShiyueSettings } from "../settings.ts";
import type { SelInfo } from "../preview/selection-cache.ts";

/** 抽取胶水:build provider/noteGen/state,调 core/extraction。从 main.ts 抽出。
 *  数据源:batch 用 PdfDocumentSource(file) file 级重读;selection 上下文同源(±2 页)。
 *  #4/#5/#8:AbortController + LoadingNotice(持续 spinner+Stop);batch 经 onConfirmed 在点「继续」后才显。 */
export class ExtractionController {
  constructor(private app: App, private plugin: Plugin, private settings: () => ShiyueSettings) {}

  /** 整篇批处理:取文本→分块→预估确认→map(每块≥1 保底)→去重→生成笔记。 */
  async extractBatch(file: TFile): Promise<void> {
    const s = this.settings();
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";  // 原样(Plan 2 验证可工作)
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey: apiKey as string, model: s.model });
    const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
    const pricing = s.pricing.find(p => p.model === s.model) ?? s.pricing[0];
    const state = new ExtractionState(this.app.vault.adapter as any);
    const ctrl = new AbortController();
    const loading = new LoadingNotice(this.app, "抽取中", () => ctrl.abort());
    const be = new BatchExtractor(this.app, provider, noteGen, { notesPath: s.notesPath, model: s.model }, pricing,
      (book, chunks, tokens, cost) => confirmCost(this.app, { book, chunks, tokens, cost }), state);
    const source = new PdfDocumentSource(file, this.app, this.plugin);
    const r = await be.extract(source, {
      signal: ctrl.signal,
      onConfirmed: () => loading.show(),                                    // #4:点「继续」后才显
      onProgress: (d, t, p) => loading.update(`${d}/${t} → ${p} 点`),
    });
    loading.hide();
    if (r.cancelled) { new Notice("已取消", 2000); return; }
    if (r.count > 0) new Notice(`✓ ${r.message}:${r.count} 个知识点(见 ${s.notesPath}/)`, 8000);
    else new Notice(`✗ ${r.message}`, 8000);
  }

  /** 选区深抽:选中段 + 上下文 ±2 页 + 已有标题 → AI 抽单点 → 生成笔记 + 打开。 */
  async extractSelection(file: TFile, sel: SelInfo): Promise<void> {
    const s = this.settings();
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey: apiKey as string, model: s.model });
    const source = new PdfDocumentSource(file, this.app, this.plugin);
    const doc = await source.getDocument();
    if (!doc) { new Notice("PDF 未加载完成"); return; }
    const ctrl = new AbortController();
    const loading = new LoadingNotice(this.app, "深抽中", () => ctrl.abort());
    loading.show();  // selection 无 confirm 门,直接显
    try {
      const contextPages: string[] = [];
      for (let pg = Math.max(1, sel.page - 2); pg <= Math.min(doc.numPages, sel.page + 2); pg++) {
        const p = await doc.getPage(pg);
        const tc = await p.getTextContent();
        contextPages.push(`第${pg}页:${pageTextFromItems(tc.items.map((it: any) => ({ str: it.str ?? "" })))}`);
      }
      const existing = this.app.vault.getFiles()
        .filter(f => f.path.startsWith(s.notesPath) && f.extension === "md")
        .map(f => f.basename).slice(0, 500);
      const se = new SelectionExtractor(provider);
      const point = await se.extract(file.basename, sel.text, sel.page, contextPages.join("\n"), existing, ctrl.signal);
      loading.hide();
      if (ctrl.signal.aborted) { new Notice("已取消", 2000); return; }
      if (!point) { new Notice("未能抽取(模型未返回有效结果)", 4000); return; }
      const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
      const path = await noteGen.generate({
        title: point.title, summary: point.summary, source_pdf: file.basename, source_page: point.source_page,
        source_text: sel.text, tags: point.tags, related: point.related.map(r => r.title), related_reasons: point.related,
        model: s.model, extraction_mode: "selection",
      });
      new Notice(`✓ 已生成:${point.title}`, 4000);
      const nf = this.app.vault.getAbstractFileByPath(path);
      if (nf instanceof TFile) await this.app.workspace.getLeaf().openFile(nf);
    } catch (e) {
      loading.hide();
      if (!ctrl.signal.aborted) new Notice(`深抽失败:${e instanceof Error ? e.message : String(e)}`, 8000);
    } finally {
      await doc.destroy?.();
    }
  }
}
