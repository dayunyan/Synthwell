// src/core/document/document-source.ts
import type { TFile, App, Plugin } from "obsidian";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** 任何可被抽取的文档源。extractor 依赖此接口,不绑 PDFViewer embed。
 *  换 Obsidian 自带预览器 / EPUB 只改实现,不动 extractor。 */
export interface DocumentSource {
  getFile(): TFile;
  getDocument(): Promise<PDFDocumentProxy | null>;  // 批处理取文本用;非 PDF 源可返回 null
  getSelection(): { text: string; page: number } | null;  // 选区即抽用;无选区能力返回 null
}

/** 文件级 PDF 源(批处理用)。不依赖 viewer——只靠 TFile + spike 的读法加载文档。
 *  getSelection 恒 null(选区由 view 提供,见 SelectionExtractor 那个 plan)。 */
export class PdfDocumentSource implements DocumentSource {
  private doc: PDFDocumentProxy | null = null;
  private file: TFile;
  private app: App;
  private plugin: Plugin;
  constructor(file: TFile, app: App, plugin: Plugin) {
    this.file = file; this.app = app; this.plugin = plugin;
  }
  getFile(): TFile { return this.file; }
  getSelection(): { text: string; page: number } | null { return null; }
  async getDocument(): Promise<PDFDocumentProxy | null> {
    // 返回的 PDFDocumentProxy 由调用方负责 destroy()(批处理结束后释放)。
    if (this.doc) return this.doc;
    // 复用 spike 集成发现 #12:getResourcePath + fetch(走 webview 有权限层,readBinary 在 TCC 下 EPERM)
    const { configureWorker } = await import("./pdf-worker-config.ts");
    configureWorker(this.app, this.plugin);
    const resourcePath = this.app.vault.adapter.getResourcePath(this.file.path);
    const buf = await (await fetch(resourcePath)).arrayBuffer();
    const pdfjsLib = await import("pdfjs-dist");
    this.doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    return this.doc;
  }
}
