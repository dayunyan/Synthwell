import { ItemView, Plugin, WorkspaceLeaf, TFile } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import { configureWorker } from "./pdf-worker";

export const SHIYUE_PDF_VIEW = "shiyue-pdf-view";

export class PdfView extends ItemView {
  file: TFile | null = null;
  private readonly plugin: Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
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
    configureWorker(this.app, this.plugin);

    // Read via getResourcePath + fetch (routes through Obsidian's entitled
    // webview layer); vault.adapter.readBinary hits EPERM under macOS TCC.
    const resourcePath = this.app.vault.adapter.getResourcePath(file.path);
    const buf = await (await fetch(resourcePath)).arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = el.createEl("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    // v4 RenderParameters takes { canvasContext, viewport } only — the
    // `canvas` field is a v6 addition absent in v4 (see
    // node_modules/pdfjs-dist/types/src/display/api.d.ts RenderParameters).
    await page.render({ canvasContext: ctx, viewport }).promise;

    // stashed for Task 5/6 cleanup; intentionally leaking until onClose lands
    (this as any)._doc = doc;
    (this as any)._page = page;
    (this as any)._canvas = canvas;
  }
}
