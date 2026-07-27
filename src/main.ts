import { Plugin, TFile, FuzzySuggestModal, Notice } from "obsidian";
import { PdfView, SHIYUE_PDF_VIEW } from "./pdf-view";
import { ShiyueSettings, DEFAULT_SETTINGS } from "./settings";
import { ShiyueSettingTab } from "./settings-tab";
import { UsageTracker } from "./usage";

export default class ShiyuePlugin extends Plugin {
  settings: ShiyueSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    this.registerView(SHIYUE_PDF_VIEW, (leaf) => new PdfView(leaf, this));

    this.addCommand({
      id: "open-pdf-in-shiyue",
      name: "拾阅: 打开 PDF",
      callback: () => this.openPdfPicker(),
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
