// src/workspace/extraction-controller.ts
import { App, Plugin, TFile, Notice } from "obsidian";
import { buildProvider } from "./llm-provider.ts";
import { PdfDocumentSource } from "../core/document/document-source.ts";
import { NoteGenerator } from "../core/extraction/note-generator.ts";
import { ExtractionState } from "../core/extraction/extraction-state.ts";
import { BatchExtractor } from "../core/extraction/batch-extractor.ts";
import { SelectionExtractor } from "../core/extraction/selection-extractor.ts";
import { pageTextFromItems } from "../core/document/pdf-text.ts";
import { confirmCost } from "../ui/confirm-modal.ts";
import { LoadingNotice } from "../ui/loading-notice.ts";
import { t } from "../i18n/index.ts";
import type { ShiyueSettings } from "../settings.ts";
import type { SelInfo } from "../preview/selection-cache.ts";
import type { ExtractionHandlers, ExtractionResult } from "./extraction-messages.ts";

/** 抽取胶水:build provider/noteGen/state,调 core/extraction。从 main.ts 抽出。
 *  数据源:batch 用 PdfDocumentSource(file) file 级重读;selection 上下文同源(±2 页)。
 *
 *  #04:两条路径统一返 ExtractionResult(无 UI 依赖):
 *   - 面板路径(handlers 传):progress/终态走回调钩子(onConfirmed/onBegin/onProgress)→ 面板转消息;
 *     AbortController 由面板持(signal 透传给 extractor),停止按钮在气泡内。无 LoadingNotice/Notice。
 *   - 命令面板路径(handlers 缺):保留 LoadingNotice(持续 spinner+Stop)+ Notice(终态)。#4/#5/#8 行为不变。
 *  early check 失败(provider 缺/doc 未加载)→ 面板路径返 fail(面板显 error);命令路径 Notice。
 *  confirmCost 模态保留(预操作门):batch 两路径都过此门;selection 无门。 */
export class ExtractionController {
  constructor(private app: App, private plugin: Plugin, private settings: () => ShiyueSettings) {}

  /** 整篇批处理:取文本→分块→预估确认→map(每块≥1 保底)→去重→生成笔记。
   *  handlers 传 → 面板路径(回调转消息);缺 → 命令面板路径(LoadingNotice+Notice)。 */
  async extractBatch(file: TFile, handlers?: ExtractionHandlers): Promise<ExtractionResult> {
    const s = this.settings();
    const provider = buildProvider(this.app, s);
    if (!provider) return this.settle(handlers, { cancelled: false, kind: "fail", message: t("notice.noApiKey") }, 4000);
    const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
    const pricing = s.pricing.find(p => p.model === s.model) ?? s.pricing[0];
    const state = new ExtractionState(this.app.vault.adapter as any);
    // AbortController:面板路径由面板持(handlers.signal);命令路径 controller 自持(LoadingNotice stop)。
    const ownCtrl = !handlers ? new AbortController() : null;
    const signal = handlers?.signal ?? ownCtrl!.signal;
    const loading = !handlers ? new LoadingNotice(this.app, t("extract.batchLabel"), () => ownCtrl!.abort()) : null;
    const be = new BatchExtractor(this.app, provider, noteGen, { notesPath: s.notesPath, model: s.model }, pricing,
      (book, chunks, tokens, cost) => confirmCost(this.app, { book, chunks, tokens, cost }), state);
    const source = new PdfDocumentSource(file, this.app, this.plugin);
    const r = await be.extract(source, {
      signal,
      onConfirmed: handlers
        ? (total) => handlers.onConfirmed?.(total)                       // 面板:append streaming reply「0/total」
        : (total) => loading!.show(`0/${total}`),                         // 命令:点「继续」后显 loading
      onProgress: handlers
        ? (done, total, points) => handlers.onProgress?.(done, total, points)  // 面板:更新 reply 文本
        : (done, total, points) => loading!.update(t("extract.progress", { done, total, points })),
    });
    loading?.hide();
    if (r.cancelled) return this.settle(handlers, { cancelled: true, kind: "cancelled", message: t("extract.cancelled") }, 2000);
    if (r.count > 0) return this.settle(handlers, { cancelled: false, kind: "success", message: t("extract.success", { message: r.message, count: r.count, notesPath: s.notesPath }) }, 8000);
    return this.settle(handlers, { cancelled: false, kind: "fail", message: t("extract.fail", { message: r.message }) }, 8000);
  }

  /** 选区深抽:选中段 + 上下文 ±2 页 + 已有标题 → AI 抽单点 → 生成笔记 + 打开。
   *  handlers 传 → 面板路径;缺 → 命令面板路径(LoadingNotice+Notice)。无 confirmCost 门。 */
  async extractSelection(file: TFile, sel: SelInfo, handlers?: ExtractionHandlers): Promise<ExtractionResult> {
    const s = this.settings();
    const provider = buildProvider(this.app, s);
    if (!provider) return this.settle(handlers, { cancelled: false, kind: "fail", message: t("notice.noApiKey") }, 4000);
    const source = new PdfDocumentSource(file, this.app, this.plugin);
    const doc = await source.getDocument();
    if (!doc) return this.settle(handlers, { cancelled: false, kind: "fail", message: t("extract.pdfNotLoaded") }, 4000);
    const ownCtrl = !handlers ? new AbortController() : null;
    const signal = handlers?.signal ?? ownCtrl!.signal;
    const loading = !handlers ? new LoadingNotice(this.app, t("extract.selectionLabel"), () => ownCtrl!.abort()) : null;
    loading?.show();              // selection 无 confirm 门:命令路径直接显 loading
    handlers?.onBegin?.();        // 面板:append streaming reply「精读中…」
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
      const point = await se.extract(file.basename, sel.text, sel.page, contextPages.join("\n"), existing, signal);
      loading?.hide();
      if (signal.aborted) return this.settle(handlers, { cancelled: true, kind: "cancelled", message: t("extract.cancelled") }, 2000);
      if (!point) return this.settle(handlers, { cancelled: false, kind: "fail", message: t("extract.noResult") }, 4000);
      const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
      const path = await noteGen.generate({
        title: point.title, summary: point.summary, source_pdf: file.basename, source_page: point.source_page,
        source_text: sel.text, tags: point.tags, related: point.related.map(r => r.title), related_reasons: point.related,
        model: s.model, extraction_mode: "selection",
      });
      const nf = this.app.vault.getAbstractFileByPath(path);
      if (nf instanceof TFile) await this.app.workspace.getLeaf().openFile(nf);
      return this.settle(handlers, { cancelled: false, kind: "success", message: t("extract.generated", { title: point.title }) }, 4000);
    } catch (e) {
      loading?.hide();
      if (signal.aborted) return this.settle(handlers, { cancelled: true, kind: "cancelled", message: t("extract.cancelled") }, 2000);
      return this.settle(handlers, { cancelled: false, kind: "fail", message: t("extract.selectionFail", { msg: e instanceof Error ? e.message : String(e) }) }, 8000);
    } finally {
      await doc.destroy?.();
    }
  }

  // ---- 终态统一封装(面板路径返 ExtractionResult;命令路径另 Notice)----

  /** 终态收口:返 ExtractionResult;命令路径(无 handlers)另 Notice(duration 调用方按场景定)。
   *  early check 失败 / 每条终态(success/cancelled/fail)均经此,消除重复 `if (!handlers) Notice` 形。 */
  private settle(handlers: ExtractionHandlers | undefined, result: ExtractionResult, noticeMs: number): ExtractionResult {
    if (!handlers) new Notice(result.message, noticeMs);
    return result;
  }
}
