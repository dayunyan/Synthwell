// PIVOT: embed pdfjs's OWN PDFViewer component instead of hand-rolling canvas +
// textLayer per page. Two prior hand-rolled attempts (minimal `new TextLayer(...)`,
// then `TextLayerBuilder`) both failed to fully fix text selection: mid-line
// selection was accurate, but line-end/page-edge over-selection persisted (the
// `.endOfContent` selection-bounding machinery + the global `selectionchange`
// listener need the FULL PDFViewer/PDFPageView context to activate). pdfjs's own
// viewer gets selection right by construction — every PDF app and the existing
// Obsidian Annotator plugin use it. This embed delegates virtualization, scroll,
// height-computation, textLayer, AND selection bounding to pdfjs.
//
// Source evidence (node_modules/pdfjs-dist v5.4.530):
//  - PDFViewer class: web/pdf_viewer.mjs line 7666. Constructor (7700-7786):
//      * this.container = options.container (7705); this.viewer =
//        options.viewer || options.container.firstElementChild (7706).
//      * BOTH must be <DIV> (7708-7709 throws "Invalid container and/or viewer").
//      * container MUST be position:absolute — 7711-7712 throws "The container
//        must be absolutely positioned" when offsetParent is set (it is, in the
//        Obsidian leaf) and computed position != "absolute". So our container
//        div is styled position:absolute;inset:0.
//      * l10n defaults to new GenericL10n() (7743) when omitted — GenericL10n
//        (3664) #getPaths (3704-3718) silently catches the missing
//        <link type="application/l10n"> and returns empty paths, so #createBundle
//        returns null and #generateBundlesFallback (3720) yields a hardcoded
//        English bundle. NO network fetch can fail in Obsidian. Safe to omit.
//      * textLayerMode defaults to TextLayerMode.ENABLE = 1 (7727; const 142-144).
//      * annotationMode defaults to AnnotationMode.ENABLE_FORMS = 2 (7728).
//      * viewerVersion check (7701-7703): pdf_viewer.mjs bundles its own
//        `version` import (line 107), so the check passes internally.
//  - setDocument: web/pdf_viewer.mjs line 8070. Renders pages into this.viewer.
//  - DOM: PDFPageView sets div.className="page" + data-page-number (6325-6326),
//    .canvasWrapper (6839-6841) > canvas, .textLayer (5993). The CONSUMER must
//    add the `.pdfViewer` class to the viewer div — pdfjs does NOT add it (grep
//    shows no classList.add("pdfViewer")). The canonical pdfjs HTML is
//    <div id="viewer" class="pdfViewer">. CSS (pdf_viewer.css 6691+) scopes
//    every rule under .pdfViewer, so that class is load-bearing.
//  - PDFViewer handles its OWN virtualization/scrolling/height via watchScroll
//    (7767) + ResizeObserver (7693/9186) + the default PDFRenderingQueue
//    (7752-7754). We must NOT add our own IntersectionObserver or placeholder
//    heights — that fights PDFViewer.
//  - getPageView(index) (7793) returns the PDFPageView; its .textLayer holds the
//    rendered TextLayerBuilder. .page[data-page-number] divs are in the DOM.
import "./pdfjs-version-shim"; // MUST be first: re-asserts globalThis.pdfjsLib
// to 5.4.530 BEFORE pdf_viewer.mjs reads `version` from it at module-load.
import { ItemView, Plugin, WorkspaceLeaf, TFile, Menu } from "obsidian";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PDFViewer, PDFLinkService, EventBus } from "pdfjs-dist/web/pdf_viewer.mjs";
// AnnotationEditorType: enum from the pdfjs API build (types/src/shared/util.d.ts
// `export namespace AnnotationEditorType`). Values: DISABLE=-1, NONE=0, ... (see
// build/pdf.mjs line 75-82). We only need DISABLE to opt out of annotation
// EDITING — we do NOT edit PDF annotations (highlights live in Obsidian via
// text-anchoring). See the setDocument note on pdf-view.ts line ~181.
import { AnnotationEditorType, AnnotationMode } from "pdfjs-dist";
import { configureWorker } from "./pdf-worker";
import { buildAnchor, pageTextFromItems } from "./highlight";

export const SHIYUE_PDF_VIEW = "shiyue-pdf-view";

export class PdfView extends ItemView {
  file: TFile | null = null;
  private readonly plugin: Plugin;
  private doc: PDFDocumentProxy | null = null;
  // The pdfjs components. Constructed in setFile, torn down in onClose.
  // PDFViewer owns the per-page canvas + textLayer + selection machinery; we
  // only hold the trio so we can clean them up (E3 memory gate).
  private eventBus: EventBus | null = null;
  private linkService: PDFLinkService | null = null;
  private pdfViewer: PDFViewer | null = null;
  // Fix 1 (blurry): pdfjs's own ResizeObserver does NOT re-evaluate the
  // "page-width" special currentScaleValue on container resize — it caches the
  // resolved numeric scale once (at pagesinit, when the Obsidian leaf may still
  // be ~168px wide) and never re-runs #setScale. So the canvas backing stays
  // tiny while the container later grows to its real width → CSS-stretch →
  // blurry. We attach OUR OWN ResizeObserver that re-sets currentScaleValue to
  // "page-width" whenever the container's width actually changes, so it re-fits
  // to the real width (and re-fits on leaf/window resize). Debounced so rapid
  // resize churn doesn't storm the render queue.
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastContainerWidth = 0;
  // Fix 3 (zoom churn): the wheel zoom handler fires on every wheel tick
  // (trackpad inertia = many events/sec). rAF-coalescing still applied a scale
  // change EVERY frame during inertia → a cancel storm (page never visibly
  // settled). Switched to a TRAILING throttle: accumulate deltaY, apply ONE
  // currentScale change per ~150ms gap so pdfjs's re-render can complete
  // between applications → no per-frame churn, with some feedback during
  // continuous scroll. zoomTimer/pendingDelta are per-view fields so onClose
  // can clear the pending timer.
  private zoomTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingZoomDelta = 0;
  // Once the user zooms manually, stop auto-fitting to page-width (otherwise the
  // ResizeObserver re-fits on every zoom-induced scrollbar/width change and
  // eats the zoom — page stays "fills window" regardless of currentScale).
  // Reset to false in setFile so each newly-opened PDF auto-fits on open.
  private userZoomed = false;
  // Plan 3: 最近一次选区(mouseup 缓存)。SelectionExtractor 的主输入。
  private lastSelection: { text: string; page: number } | null = null;

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
  /** 最近一次选区(文本 + 页码);无则 null。SelectionExtractor 的主输入。 */
  getSelection(): { text: string; page: number } | null { return this.lastSelection; }
  /** 已加载的 PDF 文档(取上下文 ±2 页文本用;复用,免重新 fetch)。未加载则 null。 */
  getDocument(): PDFDocumentProxy | null { return this.doc; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("shiyue-pdf-root");
    this.contentEl.createEl("div", { text: "选择 PDF 后在此显示" });
    // E4: capture selection→anchor on mouseup so the human can verify
    // text-anchoring works and observe CJK selection quality. Listener is
    // registered once here (onOpen runs once per view lifetime);
    // registerDomEvent auto-removes it on onClose. We do NOT render a
    // persistent highlight — that's MVP work, not spike. We just log the
    // anchor + the selected string.
    this.registerDomEvent(this.contentEl, "mouseup", () => this.onSelectionEnd());
    // Plan 3 Task 5: 选区右键 → 「深抽这个知识点」。无选区时用 Obsidian 默认菜单。
    this.registerDomEvent(this.contentEl, "contextmenu", (e: MouseEvent) => {
      if (!this.lastSelection) return;
      e.preventDefault();
      const menu = new Menu();
      menu.addItem(item => item.setTitle("深抽这个知识点").setIcon("sparkles")
        .onClick(() => (this.plugin as { extractSelection?: (v: PdfView) => void }).extractSelection?.(this)));
      menu.showAtMouseEvent(e);
    });
  }

  /** Build + log a text anchor for the current selection. No-op if no
   *  selection, or if the selection isn't inside a rendered .page[data-page-number]
   *  belonging to PDFViewer. Reads the page's text via the pdfDocument
   *  (getTextContent is cached by pdfjs) since PDFViewer does not expose the
   *  builder's joined text publicly. Errors are caught + logged so selection
   *  noise never throws into the UI. */
  private async onSelectionEnd() {
    const sel = window.getSelection();
    const selected = sel?.toString().trim() ?? "";
    // Observability: log EVERY non-empty selection so the human can confirm
    // mouseup + selection detection is firing. If this never logs, the text
    // layer spans aren't selectable at all.
    if (selected) {
      console.info("[shiyue] mouseup selection=" + JSON.stringify(selected.slice(0, 60)));
    }
    if (!selected) return;
    // PDFViewer renders .page[data-page-number] divs; find the ancestor page.
    const node = sel?.anchorNode;
    const pageEl = node instanceof Node
      ? (this.contentEl.contains(node)
        ? (node.parentElement?.closest(".page[data-page-number]") as HTMLElement | null)
        : null)
      : null;
    if (!pageEl) return;
    const page = Number(pageEl.dataset.pageNumber);
    if (!page || !this.doc) return;
    this.lastSelection = { text: selected, page };  // Plan 3: 缓存供 SelectionExtractor
    try {
      const pdfPage = await this.doc.getPage(page);
      const textContent = await pdfPage.getTextContent();
      // Joined with '' (no spaces) to match how window.getSelection stringifies
      // CJK runs (CJK has no word boundaries).
      const pageText = pageTextFromItems(
        textContent.items.map((it) => ({ str: (it as { str?: string }).str ?? "" })),
      );
      const anchor = buildAnchor(selected, pageText, page);
      console.info("[shiyue] anchor", anchor);
      console.info("[shiyue] selected:", selected);
    } catch (err) {
      // selection string didn't appear verbatim in pageText (common when CJK
      // offset makes the selection span pickup extra/partial glyphs). Log so
      // the human can SEE the gap — this is exactly E4's observation.
      console.info("[shiyue] anchor build failed for selection:", selected, err);
    }
  }

  async onClose() {
    // E3: airtight cleanup so memory returns to baseline (Annotator #233
    // failed here — 5GB never released). Order: tear down the viewer (cancels
    // in-flight renders + clears the DOM), then the doc itself. Also tear down
    // Fix 1's ResizeObserver + pending resize timer and Fix 3's pending zoom
    // rAF so no stale callback fires after the view is gone.
    if (this.zoomTimer) {
      clearTimeout(this.zoomTimer);
      this.zoomTimer = null;
    }
    this.pendingZoomDelta = 0;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.lastContainerWidth = 0;
    try { this.pdfViewer?.cleanup(); } catch { /* ignore */ }
    this.pdfViewer = null;
    this.linkService = null;
    this.eventBus = null;
    if (this.doc) {
      await this.doc.cleanup();
      await this.doc.destroy();
      this.doc = null;
    }
    this.lastSelection = null;
  }

  async setFile(file: TFile) {
    this.file = file;
    this.userZoomed = false; // each newly-opened PDF auto-fits on open
    if (this.doc) { try { await this.doc.destroy(); } catch { /* ignore */ } this.doc = null; }  // 重入:换文件先清旧 doc
    const root = this.contentEl;
    root.empty();
    root.addClass("shiyue-pdf-root");

    configureWorker(this.app, this.plugin);
    // Read via getResourcePath + fetch (routes through Obsidian's entitled
    // webview layer); vault.adapter.readBinary hits EPERM under macOS TCC.
    const resourcePath = this.app.vault.adapter.getResourcePath(file.path);
    const buf = await (await fetch(resourcePath)).arrayBuffer();
    this.doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    // DOM: container (scrolls, position:absolute — REQUIRED by PDFViewer
    // constructor line 7711-7712) > viewer (gets .pdfViewer class; pdfjs
    // appends .page[data-page-number] divs into it). The container fills the
    // leaf and scrolls internally; PDFViewer does its own virtualization.
    const container = root.createDiv({ cls: "shiyue-pdf-container" });
    const viewerEl = container.createDiv({ cls: "pdfViewer" });

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    // Belt-and-suspenders: re-assert our 5.4.530 global immediately before
    // PDFViewer construction, in case any pdfjs code reads the version
    // dynamically at construction time (the build-time onLoad patch is the
    // definitive neutralize; this covers any other dynamic reads).
    ;(globalThis as any).pdfjsLib = pdfjsLib;
    // textLayerMode 1 = TextLayerMode.ENABLE (pdf_viewer.mjs 142-144); l10n
    // omitted → GenericL10n fallback (safe, see file header). removePageBorders
    // trims the default 9px transparent border pdfjs draws around each page
    // (cleaner in a leaf).
    const pdfViewer = new PDFViewer({
      container,
      viewer: viewerEl,
      eventBus,
      linkService,
      textLayerMode: 1,
      // DISABLE annotation EDITING (AnnotationEditorType.DISABLE = -1). This is
      // the fix for the `AnnotationEditorUIManager` null-_on crash: in v5
      // pdf_viewer.mjs setDocument (line 8155), the manager is constructed iff
      // `annotationEditorMode !== AnnotationEditorType.DISABLE`. The option
      // defaults to NONE=0 (line 7729: `options.annotationEditorMode ??
      // AnnotationEditorType.NONE`), and 0 !== -1 so the manager IS built. The
      // manager constructor (build/pdf.mjs line 2734) then calls
      // `eventBus._on(...)` (line 2744) on the eventBus arg. PDFViewer threads
      // our `this.eventBus` into the constructor (line 8160), so the eventBus
      // SHOULD be non-null — but in the bundled/minified runtime under Obsidian
      // the manager's eventBus arrives null, throwing `Cannot read properties
      // of null (reading '_on')`. We don't edit PDF annotations (highlights
      // live in Obsidian via text-anchoring), so the clean fix is to opt out of
      // the editor entirely: DISABLE makes the `if` at 8155 false, the manager
      // is never constructed, and the null-eventBus path is unreachable.
      annotationEditorMode: AnnotationEditorType.DISABLE,
      // DISABLE annotation RENDERING (AnnotationMode.DISABLE = 0). The
      // linkService.setDocument fix (commit 449f12f) did NOT eliminate the
      // annotation-layer errors — the linkService REFERENCE is undefined at
      // AnnotationLayer.#linkService, not a pdfDocument issue. PDFPageView
      // (pdf_viewer.mjs line 6889) builds the AnnotationLayerBuilder ONLY iff
      // `this.#annotationMode !== AnnotationMode.DISABLE`; with ENABLE_FORMS=2
      // (the default, line 7728) it IS built, and during page draw
      // LinkAnnotationElement.render / _bindLink call linkService
      // .addLinkAttributes / getDestinationHash (build/pdf.mjs), which throw
      // `Cannot read properties of undefined (reading 'addLinkAttributes')` /
      // `getDestinationHash` on EVERY page render (initial + each zoom
      // re-render), disrupting the page draw so the textLayer's selection-
      // bounding (.endOfContent + global selectionchange listener) never
      // activates → can't select. Setting annotationMode DISABLE makes the gate
      // at 6889 false → no AnnotationLayerBuilder → no LinkAnnotationElement
      // → no error → page draw completes cleanly → textLayer selection
      // bounding activates → selection works. Zoom re-renders are clean too.
      // MVP follow-up: properly wire linkService into
      // PDFViewer._layerProperties (or however v5 threads it to
      // AnnotationLayer.#linkService) to RE-ENABLE annotation rendering (links/
      // form fields) — for the spike, disabling is acceptable since annotations
      // aren't core to reading+selection.
      annotationMode: AnnotationMode.DISABLE,
      removePageBorders: true,
    });
    linkService.setViewer(pdfViewer);

    this.eventBus = eventBus;
    this.linkService = linkService;
    this.pdfViewer = pdfViewer;

    // Hand the loaded doc to BOTH the viewer AND the linkService. The canonical
    // pdfjs setup (PDFViewerApplication.open / web/app.mjs) calls, in order:
    //   pdfLinkService.setViewer(pdfViewer)
    //   pdfViewer.setDocument(pdfDocument)
    //   pdfLinkService.setDocument(pdfDocument, baseUrl)   ← we were MISSING this
    // Without setDocument, linkService.pdfDocument stays null. The annotation
    // layer (AnnotationLayerBuilder → AnnotationLayer → LinkAnnotationElement)
    // is handed our PDFLinkService via PDFViewer._layerProperties.linkService
    // (pdf_viewer.mjs 7933-7963, 8205). During page draw, LinkAnnotationElement
    // .render / _bindLink call linkService.addLinkAttributes /
    // getDestinationHash (build/pdf.mjs 17313, 17351). Those methods themselves
    // only touch baseUrl/externalLink* (set in the constructor), but the
    // half-initialized linkService leaves the annotation render pipeline in a
    // state where downstream calls (e.g. executeNamedAction / goToDestination,
    // which guard on pdfDocument) misbehave, and the cascade aborts the page
    // draw pipeline BEFORE the textLayer finishes rendering its spans →
    // "[shiyue] textlayer page 1 spans 0" → no selectable text. setDocument
    // completes linkService init so the annotation layer renders cleanly and
    // the page draw pipeline completes → textLayer spans populate.
    // Signature (pdf_viewer.mjs 1480): setDocument(pdfDocument, baseUrl = null).
    linkService.setDocument(this.doc);

    // Hand the loaded doc to the viewer. This triggers pagesinit → PDFViewer
    // builds .page placeholders for every page and renders the visible ones via
    // its own rendering queue. We do nothing else — no observer, no heights.
    pdfViewer.setDocument(this.doc);

    // Auto-fit: open at page-width (best for reading CJK + EN). currentScaleValue
    // (pdf_viewer.mjs setter line 7880) accepts "auto"|"page-fit"|"page-actual"
    // |"page-width"|numeric; "page-width" resolves to pageWidthScale = container
    // .clientWidth / currentPage.width (line 8519) inside #setScale.
    //
    // Fix 1 (blurry render): we previously set currentScaleValue="page-width" on
    // the `pagesinit` event. But pagesinit fires BEFORE the Obsidian leaf has
    // finished laying out → container.clientWidth ~168px → pageWidthScale ~0.27
    // → canvas backing ~334px. The container then grows to its real ~816px, but
    // pdfjs's own ResizeObserver (pdf_viewer.mjs 9184) does NOT re-run #setScale
    // for the cached "page-width" special value — it caches the resolved numeric
    // scale. The canvas is then CSS-stretched 2.4× to fill 816px → blurry.
    //
    // Fix: attach OUR OWN ResizeObserver on the container. Its FIRST callback
    // fires once the container is laid out (real width), and we re-set
    // currentScaleValue="page-width" there + on every subsequent real width
    // change → #setScale re-resolves against the real width → canvas backing
    // matches display × DPR → sharp. Debounced (~150ms) so rapid resize churn
    // doesn't storm the render queue. Only act when width changed by >1px to
    // ignore sub-pixel/height-only ResizeObserver callbacks.
    //
    // We keep the pagesinit hook as a fallback (it applies an initial best-
    // guess scale before the container is fully laid out; the RO then corrects
    // it to the true page-width once the real width is known).
    eventBus.on("pagesinit", () => {
      pdfViewer.currentScaleValue = "page-width";
    });

    this.resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth;
      if (width === 0) return; // view torn down / hidden
      if (this.userZoomed) return; // user zoomed manually — don't auto-refit
      if (Math.abs(width - this.lastContainerWidth) <= 1) return; // no real change
      this.lastContainerWidth = width;
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (!this.pdfViewer) return; // torn down during the debounce
        this.pdfViewer.currentScaleValue = "page-width";
      }, 150);
    });
    this.resizeObserver.observe(container);

    // Observability: log the textLayer span count on the textlayerrendered event,
    // which pdfjs dispatches per page AFTER the textLayer finishes rendering its
    // spans (canvas renders first, then text content loads async, THEN
    // textlayerrendered fires). onePageRendered fires earlier (canvas laid out)
    // and may log spans 0 because the text content hasn't loaded yet — so we hook
    // textlayerrendered for the authoritative count. Keep onePageRendered too
    // (harmless, mirrors the old log). evt.source is the textLayer (TextLayer);
    // evt.pageNumber is 1-based.
    eventBus.on("textlayerrendered", (evt: { pageNumber: number }) => {
      const pv = pdfViewer.getPageView(evt.pageNumber - 1);
      const spans = pv?.textLayer?.div?.querySelectorAll("span").length ?? 0;
      console.info("[shiyue] textlayer page", evt.pageNumber, "spans", spans);
    });
    // onePageRendered is a v5 GETTER (pdf_viewer.mjs 7927-7928) returning
    // _onePageRenderedCapability.promise (a bare Promise) or null — NOT a
    // {promise} deferred. Using .promise on it yielded undefined→.then threw.
    // Use it directly; guard for null (no doc / view torn down).
    const onePageRendered = pdfViewer.onePageRendered;
    if (onePageRendered) {
      onePageRendered.then(() => {
        const pv = pdfViewer.getPageView(0);
        const spans = pv?.textLayer?.div?.querySelectorAll("span").length ?? 0;
        console.info("[shiyue] textlayer page 1 spans (onePageRendered)", spans);
      }).catch(() => { /* view torn down before first render */ });
    }

    // Zoom: pdfjs v5.4.530's shipped library (web/pdf_viewer.mjs) does NOT bind
    // Ctrl/Cmd+wheel or pinch-to-zoom — grep for "wheel"/"gesture"/"touchmove"
    // in pdf_viewer.mjs returns nothing. Those handlers live in the full web
    // app (web/app.mjs / grab_to_pan.js), which the npm package does NOT ship.
    // So zoom was never wired by pdfjs; we bind it ourselves on the container.
    // Ctrl/Cmd+wheel → bump currentScale; pinch is left to the host (Obsidian
    // webview) since gesture events aren't in the shipped library either.
    // Clamp to pdfjs's supported range (0.25–4). passive:false so we can
    // preventDefault and stop the page from scrolling while zooming.
    //
    // Fix 3 (zoom churn): the naive handler fired on EVERY wheel tick (trackpad
    // inertia = many events/sec) → each set a new currentScale →
    // #setScaleUpdatePages re-rendered, cancelling the in-flight render
    // (RenderingCancelledException) → render storm, page never settled →
    // "zoom unusable." Coalesce rapid wheel events into ONE currentScale change
    // per animation frame: accumulate deltaY into pendingZoomDelta, schedule a
    // single rAF that applies the accumulated delta once, so renders can
    // complete between frames. registerDomEvent auto-removes the listener on
    // close; the pending rAF is cancelled in onClose.
    this.registerDomEvent(container, "wheel", (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.pendingZoomDelta += e.deltaY > 0 ? -0.1 : 0.1;
      // Trailing throttle: if a timer is already pending, just accumulate; the
      // existing timer applies the combined delta. ~one currentScale change per
      // 150ms so pdfjs's re-render completes between applications (no per-frame
      // cancel storm). registerDomEvent auto-removes on close; the timer is
      // cleared in onClose.
      if (this.zoomTimer) return;
      this.zoomTimer = setTimeout(() => {
        this.zoomTimer = null;
        if (!this.pdfViewer) { this.pendingZoomDelta = 0; return; }
        const next = Math.max(
          0.25,
          Math.min(4, this.pdfViewer.currentScale + this.pendingZoomDelta),
        );
        this.pendingZoomDelta = 0;
        // Switch to a fixed numeric scale (clears the "page-width" special mode)
        // + mark userZoomed so the ResizeObserver stops auto-refitting — otherwise
        // the RO re-fits to window width on every zoom-induced scrollbar change
        // and eats the zoom (display stays "fills window", only sharpness changes).
        this.pdfViewer.currentScaleValue = String(next);
        this.userZoomed = true;
      }, 150);
    }, { passive: false });
  }
}
