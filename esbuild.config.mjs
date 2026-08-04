import esbuild from "esbuild";
import process from "process";
import { cpSync, existsSync } from "fs";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

// Copy the pdfjs worker (an ES module shipped ONLY as .mjs in v6) next to
// main.js so PdfDocumentSource (file-level PDF re-read for batch text +
// selection context) can resolve it via Obsidian's app:// URL at runtime.
// Runs after every build (incl. watch rebuilds) via onEnd.
// (The spike-embed's patchPdfViewerVersionCheck plugin was retired with the
// embedded PDFViewer in plan-b task10 — the native viewer needs no version patch.)
const copyPdfWorker = {
  name: "copy-pdf-worker",
  setup(build) {
    build.onEnd(() => {
      const src = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
      const dst = "pdf.worker.min.mjs";
      if (existsSync(src)) {
        cpSync(src, dst);
        console.info(`[shiyue] copied ${src} -> ${dst}`);
      } else {
        console.warn(
          `[shiyue] WARNING: ${src} not found — pdfjs worker will NOT be copied. ` +
            `Reinstall pdfjs-dist or adjust esbuild.config.mjs.`,
        );
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [copyPdfWorker],
});

if (prod) { await context.rebuild(); process.exit(0); } else { await context.watch(); }
