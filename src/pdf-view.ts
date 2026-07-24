import { ItemView, Plugin, WorkspaceLeaf, TFile } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
// v4 TextLayer: constructor takes { textContentSource, container, viewport }
// then .render() — see node_modules/pdfjs-dist/types/src/display/text_layer.d.ts
// (TextLayerParameters, line 3-20; class TextLayer line 33-85). Unlike v6
// there is no `.textLayer` RenderParameters field, so we construct it
// manually beside the canvas. TextLayer is exported as a value from the
// main entry (pdfjs-dist/types/src/pdf.d.ts line 52); use InstanceType for the
// field type since the class isn't re-exported as a type.
import { configureWorker } from "./pdf-worker";
import { buildAnchor, pageTextFromItems } from "./highlight";

export const SHIYUE_PDF_VIEW = "shiyue-pdf-view";

type TextLayerInstance = InstanceType<typeof pdfjsLib.TextLayer>;

interface RenderedPage {
  canvas: HTMLCanvasElement;
  task: RenderTask;
  page: PDFPageProxy;
  // E4: TextLayer + its render promise so we can cancel/clean on destroy.
  textLayer: TextLayerInstance | null;
}

export class PdfView extends ItemView {
  file: TFile | null = null;
  private readonly plugin: Plugin;
  private doc: PDFDocumentProxy | null = null;
  private numPages = 0;
  private renderedPages = new Map<number, RenderedPage>();
  private observer: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return SHIYUE_PDF_VIEW;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "拾阅 PDF";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl("div", { text: "选择 PDF 后在此显示" });
    // E4: capture selection→anchor on mouseup so the human can verify
    // text-anchoring works and observe CJK selection quality on v4 (which
    // lacks the #20334 word-spacing fix). Listener is registered once here
    // (onOpen runs once per view lifetime); registerDomEvent auto-removes it
    // on onClose. We do NOT render a persistent highlight — that's MVP work,
    // not spike. We just log the anchor + the selected string.
    this.registerDomEvent(this.contentEl, "mouseup", () => this.onSelectionEnd());
  }

  /** Build + log a text anchor for the current selection. No-op if no
   *  selection, or if the selection isn't inside a rendered .shiyue-page
   *  with stored pageText (e.g. user dragged across pages, or page text not
   *  yet fetched). Errors are caught + logged so selection noise never
   *  throws into the UI. */
  private onSelectionEnd() {
    const sel = window.getSelection();
    const selected = sel?.toString().trim() ?? "";
    if (!selected) return;
    // walk up from the anchor node to the .shiyue-page placeholder.
    const node = sel?.anchorNode;
    const ph = node instanceof Node
      ? (this.contentEl.contains(node)
        ? (node.parentElement?.closest(".shiyue-page") as HTMLElement | null)
        : null)
      : null;
    if (!ph) return;
    const pageText = ph.dataset.pageText;
    if (!pageText) return;
    const page = Number(ph.dataset.page);
    try {
      const anchor = buildAnchor(selected, pageText, page);
      console.info("[shiyue] anchor", anchor);
      console.info("[shiyue] selected:", selected);
    } catch (err) {
      // selection string didn't appear verbatim in pageText (common when v4's
      // CJK offset makes the selection span pickup extra/partial glyphs).
      // Log so the human can SEE the gap — this is exactly E4's observation.
      console.info("[shiyue] anchor build failed for selection:", selected, err);
    }
  }

  async onClose() {
    // E3: airtight cleanup so memory returns to baseline (Annotator #233
    // failed here — 5GB never released). Order matters: drop the observer
    // first so it can't schedule new renders mid-teardown, then destroy every
    // rendered page (cancels in-flight tasks + frees canvases), then tear down
    // the doc itself.
    this.observer?.disconnect();
    this.observer = null;
    for (const p of [...this.renderedPages.keys()]) this.destroyPage(p);
    if (this.doc) {
      await this.doc.cleanup();
      await this.doc.destroy();
      this.doc = null;
    }
    this.numPages = 0;
  }

  async setFile(file: TFile) {
    this.file = file;
    const el = this.contentEl;
    el.empty();
    // scroll container must be the contentEl (tall, scrollable) so the
    // IntersectionObserver can use it as `root`.
    el.style.overflowY = "auto";

    configureWorker(this.app, this.plugin);
    // Read via getResourcePath + fetch (routes through Obsidian's entitled
    // webview layer); vault.adapter.readBinary hits EPERM under macOS TCC.
    const resourcePath = this.app.vault.adapter.getResourcePath(file.path);
    const buf = await (await fetch(resourcePath)).arrayBuffer();
    this.doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    this.numPages = this.doc.numPages;

    // one placeholder div per page; rendered on demand by the observer. The
    // minHeight gives the scrollbar true length before a page is rendered, so
    // the user can drag into the middle of the doc without the bar jumping.
    for (let i = 1; i <= this.numPages; i++) {
      const ph = el.createEl("div", { cls: "shiyue-page" });
      ph.dataset.page = String(i);
      ph.style.minHeight = "1000px";
    }

    this.setupObserver();
    // render the first visible page immediately so the user sees something
    // without scrolling (observer fires async otherwise).
    void this.renderPage(1);
  }

  private setupObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting) void this.renderPage(p);
          else this.destroyPage(p);
        }
      },
      // ±~2 pages of pre-render: rootMargin extends the visible band so pages
      // just above/below the viewport are rendered before they scroll in.
      { root: this.contentEl, rootMargin: "2000px 0px" },
    );
    this.contentEl
      .querySelectorAll<HTMLElement>(".shiyue-page")
      .forEach((d) => this.observer!.observe(d));
  }

  private async renderPage(p: number) {
    if (this.renderedPages.has(p) || !this.doc) return;
    const ph = this.contentEl.querySelector<HTMLElement>(
      `[data-page="${p}"]`,
    );
    if (!ph) return;
    const page = await this.doc.getPage(p);
    // re-check after the await: the page may have been scrolled away (and
    // destroyed) while getPage was in flight, or the doc may be gone (onClose).
    if (!this.doc || this.renderedPages.has(p)) {
      try { page.cleanup(); } catch { /* ignore */ }
      return;
    }
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = ph.createEl("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = "100%";
    const ctx = canvas.getContext("2d")!;
    // v4 RenderParameters takes { canvasContext, viewport } only — the
    // `canvas` field is a v6 addition absent in v4 (see
    // node_modules/pdfjs-dist/types/src/display/api.d.ts RenderParameters).
    const task = page.render({ canvasContext: ctx, viewport });
    // E4: overlay a pdfjs TextLayer on the canvas so text is selectable. The
    // spans are transparent (color:transparent in styles.css) and positioned to
    // match glyph coordinates, so they sit *on top* of the canvas. Selection
    // then reads window.getSelection().toString() — for CJK (no spaces) the
    // string matches what pageTextFromItems joins, which is what buildAnchor
    // searches against.
    const textLayerDiv = ph.createEl("div", { cls: "textLayer" });
    let textLayer: TextLayerInstance | null = null;
    this.renderedPages.set(p, { canvas, task, page, textLayer: null });
    ph.style.minHeight = ""; // clear placeholder height once real canvas laid out
    try {
      await task.promise;
      // Build the text layer AFTER the canvas render so layout is settled.
      // textContentSource accepts either a TextContent or a ReadableStream;
      // we pass the resolved TextContent directly (simpler, and we need the
      // items anyway to store page text for selection→anchor capture).
      const textContent = await page.getTextContent();
      // Store the page's full text on the placeholder so the mouseup handler
      // can build an anchor without re-fetching. Joined with '' (no spaces)
      // to match how window.getSelection stringifies CJK runs. TextContent
      // items are a union of TextItem (has .str) and TextMarkedContent (no
      // .str) — we narrow to items with a string .str, else "".
      ph.dataset.pageText = pageTextFromItems(
        textContent.items.map((it) => ({ str: (it as { str?: string }).str ?? "" })),
      );
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      this.renderedPages.get(p)!.textLayer = textLayer;
      await textLayer.render();
    } catch (err) {
      // cancelled render (scroll-away) — clean up the partial entry iff it
      // still points at this task (a re-render may have replaced it).
      if (this.renderedPages.get(p)?.task === task) this.destroyPage(p);
    }
  }

  private destroyPage(p: number) {
    const r = this.renderedPages.get(p);
    if (!r) return;
    try { r.textLayer?.cancel(); } catch { /* already done */ }
    try { r.task.cancel(); } catch { /* already done */ }
    // zeroing the canvas backing store is what actually frees the GPU/heap
    // memory (just removing the element keeps the bitmap alive).
    r.canvas.width = 0;
    r.canvas.height = 0;
    r.canvas.remove();
    try { r.page.cleanup(); } catch { /* ignore */ }
    this.renderedPages.delete(p);
  }
}
