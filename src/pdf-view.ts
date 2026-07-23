import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import { configureWorker } from "./pdf-worker";

export const SHIYUE_PDF_VIEW = "shiyue-pdf-view";

export class PdfView extends ItemView {
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return SHIYUE_PDF_VIEW; }
  getDisplayText(): string { return this.file?.basename ?? "拾阅 PDF"; }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.createEl("div", { text: "选择 PDF 后在此显示" });
  }

  async onClose() {
    // Task 6 在此做内存清理
  }

  async setFile(file: TFile) {
    this.file = file;
    const el = this.contentEl;
    el.empty();
    configureWorker(); // Task 4 后此调用才真正生效

    const buf = await this.app.vault.adapter.readBinary(file.path);
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = el.createEl("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, canvas, viewport } as any).promise;

    (this as any)._doc = doc;
    (this as any)._page = page;
    (this as any)._canvas = canvas;
  }
}
