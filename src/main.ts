import { Plugin, TFile, FuzzySuggestModal, Notice } from "obsidian";
import { PdfView, SHIYUE_PDF_VIEW } from "./pdf-view";

export default class ShiyuePlugin extends Plugin {
  async onload() {
    this.registerView(SHIYUE_PDF_VIEW, (leaf) => new PdfView(leaf));

    this.addCommand({
      id: "open-pdf-in-shiyue",
      name: "拾阅: 打开 PDF",
      callback: () => this.openPdfPicker(),
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(SHIYUE_PDF_VIEW);
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
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({ type: SHIYUE_PDF_VIEW, state: {} });
    const view = leaf.view;
    if (view instanceof PdfView) {
      await view.setFile(file);
    }
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
