import { ItemView, Plugin, WorkspaceLeaf, TFile } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
// P1 (selection): use pdfjs's OWN TextLayerBuilder instead of hand-rolling
// `new TextLayer(...)`. The builder is the component pdfjs's own PDFPageView
// uses (node_modules/pdfjs-dist/web/pdf_viewer.mjs TextLayerBuilder, exported
// at line 9358; constructed at PDFPageView.draw line 6877). Two reasons this is
// the correct fix, not a cosmetic swap:
//
//  (1) `.endOfContent` + the global selection listener. The builder's
//      #bindMouse + #enableGlobalSelectionListener (pdf_viewer.mjs 6051-6167)
//      create the `.endOfContent` element AND, on every `selectionchange`, MOVE
//      it next to the active selection anchor sized to the textLayer. That
//      element is what bounds selection at page/line edges — without it the
//      browser keeps extending the selection past the last glyph into the
//      next line / next page (the "drag to edge selects whole page" + "last
//      chars of a line grab the next several lines" showstoppers). Our old
//      hand-rolled `new TextLayer(...)` never ran #bindMouse, so the
//      `.endOfContent` div sat inert at `inset:100% 0 0` and did nothing.
//      There is no clean way to replicate the ~80 lines of selection tracking
//      by hand; delegating to the builder is strictly more correct.
//
//  (2) `streamTextContent({ includeMarkedContent:true, disableNormalization:true })`
//      (pdf_viewer.mjs 6009-6012). The builder streams text with
//      disableNormalization, which the old getTextContent() defaults did NOT
//      — a subtle text/spacing divergence that affects CJK hitbox accuracy.
//
// setLayerDimensions + --scale-factor: the builder does NOT size its own
// container or set the scale CSS var (PDFPageView does that). We replicate
// exactly those two things: set `--scale-factor` = viewport.scale on the
// page container, and call pdfjs's setLayerDimensions on the builder's div.
// These feed the span font-size calc (`--text-scale-factor * --font-height`,
// pdf_viewer.css 915/923) that our old minimal CSS extract was missing
// entirely — that missing font-size math was the vertical-offset /
// CJK-width-mismatch root cause.
import { TextLayerBuilder } from "pdfjs-dist/web/pdf_viewer.mjs";
import { configureWorker } from "./pdf-worker";
import { buildAnchor, pageTextFromItems } from "./highlight";

export const SHIYUE_PDF_VIEW = "shiyue-pdf-view";

// setLayerDimensions sizes a layer div to the viewport via the
// --total-scale-factor CSS var (see build/pdf.mjs line 1602). Exported as a
// value from the main entry (pdf.mjs line 26375 / types src/pdf.d.ts).
const { setLayerDimensions } = pdfjsLib;

interface RenderedPage {
  canvas: HTMLCanvasElement;
  task: RenderTask;
  page: PDFPageProxy;
  // P1: the builder owns its own `.div` (the textLayer container) and the
  // `.endOfContent` element + global selection listeners. We hold it so we
  // can cancel() (which also calls #removeGlobalSelectionListener) on destroy.
  textLayer: TextLayerBuilder | null;
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
    // Observability: log EVERY non-empty selection so the human can confirm
    // mouseup + selection detection is firing (independent of whether a
    // .shiyue-page ancestor + pageText are found). If this never logs, the
    // text layer spans aren't selectable at all.
    if (selected) {
      console.info("[shiyue] mouseup selection=" + JSON.stringify(selected.slice(0, 60)));
    }
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
    // P1 alignment invariant: ONE viewport object, used for BOTH the canvas
    // render and the text layer. pdfjs positions textLayer spans using this
    // viewport's transform; the canvas rasterizes glyphs using the same
    // transform. Identical viewport => spans land on glyphs. (Our old code
    // also used one viewport, so the invariant held — the alignment bug was
    // the MISSING span font-size CSS, fixed in styles.css, not here.)
    const viewport = page.getViewport({ scale: 1.5 });
    // --scale-factor must equal viewport.scale so the span font-size calc
    // (styles.css: --text-scale-factor * --font-height) reproduces the glyph
    // height pdfjs baked into each span's inline --font-height. This mirrors
    // PDFPageView's standalone path (pdf_viewer.mjs line 6336/6675).
    ph.style.setProperty("--scale-factor", String(viewport.scale));

    const canvas = ph.createEl("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = "100%";
    const task = page.render({ canvas, viewport });
    // P1: TextLayerBuilder owns its `.div`; we hold the builder so we can
    // cancel() on destroy (which also detaches the global selection listener).
    let textLayer: TextLayerBuilder | null = null;
    this.renderedPages.set(p, { canvas, task, page, textLayer: null });
    ph.style.minHeight = ""; // clear placeholder height once real canvas laid out
    // The canvas render and the TextLayer render are independent failure
    // modes. Canvas render has its own try (scroll-away cancel tears down the
    // page as before); the TextLayer path is a SEPARATE try that logs the
    // error explicitly and KEEPS the canvas so the human still sees the page.
    try {
      await task.promise;
    } catch (err) {
      // cancelled render (scroll-away) — clean up the partial entry iff it
      // still points at this task (a re-render may have replaced it).
      if (this.renderedPages.get(p)?.task === task) this.destroyPage(p);
      return;
    }
    if (!this.doc || !this.renderedPages.has(p)) {
      try { page.cleanup(); } catch { /* ignore */ }
      return;
    }
    try {
      // P1: build via TextLayerBuilder. It constructs the textLayer container
      // (`.div`), streams text with disableNormalization, appends
      // `.endOfContent`, and binds the global selection listener that bounds
      // edge selection — all the selection machinery the old hand-rolled
      // TextLayer lacked.
      textLayer = new TextLayerBuilder({ pdfPage: page });
      this.renderedPages.get(p)!.textLayer = textLayer;
      // Size the textLayer container to the viewport exactly (matches the
      // canvas backing-store dims, so spans map 1:1 onto glyphs). The builder
      // does not do this itself — PDFPageView calls setLayerDimensions for it.
      setLayerDimensions(textLayer.div, viewport);
      // Place the textLayer over the canvas. The CSS in styles.css scopes the
      // full pdfjs .textLayer rules under .shiyue-page so they don't clash
      // with Obsidian's own (Obsidian ships its own .textLayer for its native
      // PDF view).
      ph.append(textLayer.div);
      await textLayer.render({ viewport });

      // Store the page's full text on the placeholder so the mouseup handler
      // can build an anchor without re-fetching. The builder streams text
      // internally but does not expose the joined items publicly, so fetch
      // getTextContent() separately for the anchor string (cheap — pdfjs
      // caches it). Joined with '' (no spaces) to match how
      // window.getSelection stringifies CJK runs.
      const textContent = await page.getTextContent();
      ph.dataset.pageText = pageTextFromItems(
        textContent.items.map((it) => ({ str: (it as { str?: string }).str ?? "" })),
      );

      console.info(
        "[shiyue] textlayer page", p,
        "spans", textLayer.div.querySelectorAll("span").length,
      );
    } catch (err) {
      // Do NOT destroy the page — the canvas is already on screen. Log the
      // TextLayer failure explicitly so the human sees what broke.
      console.error("[shiyue] textlayer FAILED page", p, err);
    }
  }

  private destroyPage(p: number) {
    const r = this.renderedPages.get(p);
    if (!r) return;
    // P1: cancel() detaches the builder's global selection listeners
    // (#removeGlobalSelectionListener) so they don't accumulate across the
    // virtual-scroll destroy/render cycle. It does NOT remove the builder's
    // .div from the DOM — we do that explicitly so a re-render doesn't leave
    // an orphaned (cancelled) textLayer div inside the placeholder.
    try { r.textLayer?.cancel(); } catch { /* already done */ }
    try { r.textLayer?.div.remove(); } catch { /* already gone */ }
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
