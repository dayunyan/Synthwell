import esbuild from "esbuild";
import process from "process";
import { cpSync, existsSync } from "fs";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

// Copy the pdfjs worker (an ES module shipped ONLY as .mjs in v6) next to
// main.js so pdf-view/pdf-worker can resolve it via Obsidian's app:// URL at
// runtime. Runs after every build (incl. watch rebuilds) via onEnd.
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
        // Guarded: don't crash the build if the file is missing, but make
        // the failure loud so the human sees the worker won't spawn.
        console.warn(
          `[shiyue] WARNING: ${src} not found — pdfjs worker will NOT be copied. ` +
            `Reinstall pdfjs-dist or adjust esbuild.config.mjs.`,
        );
      }
    });
  },
};

// Neutralize pdf_viewer.mjs's runtime API/Viewer version check at build time.
// The check reads `version` (destructured from globalThis.pdfjsLib at module
// load) against the literal viewerVersion "5.4.530". Obsidian re-asserts its
// own bundled 5.3.34 globalThis.pdfjsLib AFTER our module-load shim runs, so a
// runtime shim loses the race. Patching the condition to `false` at build is
// definitive: the throw becomes dead code regardless of what the global holds.
const patchPdfViewerVersionCheck = {
  name: "patch-pdf-viewer-version-check",
  setup(build) {
    // Match the installed node_modules path (and any other pdf_viewer.mjs).
    build.onLoad({ filter: /pdfjs-dist[\\/]web[\\/]pdf_viewer\.mjs$/ }, async (args) => {
      const { readFileSync } = await import("fs");
      let source = readFileSync(args.path, "utf8");
      // Replace the exact condition `version !== viewerVersion` with `false`.
      // This is the constructor's version guard (~line 7702): the throw is now
      // unreachable. We use a literal string replace (the source is stable).
      const before = source;
      source = source.replace(
        /if \(version !== viewerVersion\) \{\s*throw new Error\(`The API version "[^`]*`[^)]*\);\s*\}/,
        '/* [shiyue] version check neutralized at build */ void 0;',
      );
      if (source === before) {
        // Fallback: just neutralize the condition, leaving the throw in place
        // (dead code). Matches `if (version !== viewerVersion)`.
        source = before.replace(
          /\bversion !== viewerVersion\b/g,
          "false /* [shiyue] patched */",
        );
      }
      console.info("[shiyue] patched pdf_viewer version check");
      return { contents: source, loader: "js", resolveDir: "." };
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
  plugins: [copyPdfWorker, patchPdfViewerVersionCheck],
});

if (prod) { await context.rebuild(); process.exit(0); } else { await context.watch(); }
