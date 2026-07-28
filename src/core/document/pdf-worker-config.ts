// src/core/document/pdf-worker-config.ts
import { App, normalizePath, Plugin } from "obsidian";
import { GlobalWorkerOptions, version } from "pdfjs-dist";

/** 配置 pdfjs worker(off-main-thread)。worker 文件 `pdf.worker.min.mjs` 由 esbuild
 *  `copyPdfWorker` 插件拷到插件根,served via app:// resource URL。pdfjs v6 worker 只出 ESM,
 *  pdfjs 自行 new Worker(workerSrc,{type:"module"}) + 处理 app:// 跨源 blob 包裹。
 *  从根级 pdf-worker.ts 移入 core/document/(Plan B:spike 退役,但文件级重读仍需此函数)。 */
export function configureWorker(app: App, plugin: Plugin): void {
  const workerFile = "pdf.worker.min.mjs";
  const dir = plugin.manifest.dir ?? "";
  const workerPath = normalizePath(dir ? `${dir}/${workerFile}` : workerFile);
  const workerSrc = app.vault.adapter.getResourcePath(workerPath);
  GlobalWorkerOptions.workerSrc = workerSrc;
  console.info(`[shiyue] pdfjs ${version}: workerSrc = ${workerSrc}`);
}
