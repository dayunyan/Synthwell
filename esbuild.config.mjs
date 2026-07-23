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
