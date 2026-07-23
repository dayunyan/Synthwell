import { App, normalizePath, Plugin } from "obsidian";
import { GlobalWorkerOptions, version } from "pdfjs-dist";

/**
 * Task 4 (E1) — configure the pdfjs worker so it spawns off-main-thread.
 *
 * Context (verified against installed pdfjs-dist v6.1.200 source,
 * `build/pdf.mjs` PDFWorker.#initialize ~L16014-16060):
 *  - pdfjs v6 ships the worker ONLY as an ES module (`pdf.worker.min.mjs`).
 *    There is no UMD/`.js` variant. So the worker MUST be loaded as a module
 *    worker: pdfjs does `new Worker(workerSrc, { type: "module" })` itself.
 *  - pdfjs does NOT fetch the worker in the main thread; `workerSrc` is handed
 *    straight to `new Worker(...)`.
 *  - Cross-origin escape hatch: when `window.location` is not same-origin with
 *    `workerSrc` (Obsidian's `app://` origin resolves to `"null"`, so the
 *    same-origin check fails), pdfjs builds a blob `await import("<workerSrc>")`
 *    and spawns the module worker from that blob — the module worker then
 *    dynamically `import()`s the real worker from the `app://` URL. This is
 *    exactly what makes custom-scheme worker loading robust under Electron.
 *
 * Approach chosen: A — static worker file copied to the plugin root by
 * esbuild.config.mjs, served via Obsidian's `app://` resource URL. This reuses
 * the `getResourcePath` path already proven to work for the PDF file fetch in
 * pdf-view.ts, and lets pdfjs handle module-worker spawning + cross-origin
 * wrapping itself.
 *
 * Why not the alternatives:
 *  - B (`new URL(..., import.meta.url)`): bundle is `format: "cjs"`, so
 *    `import.meta.url` is `undefined`. Not usable without switching to ESM,
 *    which is unsafe for Obsidian's plugin loader.
 *  - C (`workerPort` + manual `new Worker`): equivalent to A but forces us to
 *    re-implement pdfjs's same-origin / module-type logic. Strictly worse.
 *  - D (blob-as-classic-worker): worker is ESM; a classic blob can't `import`
 *    an `app://` module without the very wrapper pdfjs already builds. Fragile.
 *
 * If approach A fails in Obsidian, the cheap fallbacks to try next are:
 *   1. Assign `workerPort` instead of `workerSrc` — build the Worker ourselves
 *      from the same resource URL (`new Worker(url, { type: "module" })`) and
 *      hand the port to pdfjs (approach C).
 *   2. Inline the worker via esbuild's `text` loader as `?raw`, build a blob
 *      `{ type: "module" }`, and assign that blob URL to `workerSrc` (approach
 *      D, module variant).
 */
export function configureWorker(app: App, plugin: Plugin): void {
  const workerFile = "pdf.worker.min.mjs";
  // plugin.manifest.dir is the vault-relative path to the plugin folder,
  // e.g. ".obsidian/plugins/shiyue". The worker is copied there at build time.
  const dir = plugin.manifest.dir ?? "";
  const workerPath = normalizePath(dir ? `${dir}/${workerFile}` : workerFile);

  // getResourcePath returns an app://-style URI the Electron renderer can fetch
  // and that module workers / dynamic import() can resolve against the
  // registered `app` scheme. Same family of URL the PDF fetch already uses.
  const workerSrc = app.vault.adapter.getResourcePath(workerPath);

  GlobalWorkerOptions.workerSrc = workerSrc;

  // eslint-disable-next-line no-console
  console.info(`[shiyue] pdfjs ${version}: workerSrc = ${workerSrc}`);
}
