import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

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
    this.contentEl.empty();
    this.contentEl.createEl("div", { text: `加载中: ${file.basename}` });
    // Task 3 在此渲染
  }
}
