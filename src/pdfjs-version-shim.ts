// Cause-C fix for the pdfjs API/Viewer version mismatch.
//
// ROOT CAUSE (forensics against installed pdfjs-dist@5.4.530 + Obsidian's
// bundled pdfjs in obsidian.asar):
//  - `web/pdf_viewer.mjs` reads its `version` field from `globalThis.pdfjsLib`
//    at MODULE-LOAD time, NOT from an `import` of `build/pdf.mjs`. See
//    `node_modules/pdfjs-dist/web/pdf_viewer.mjs` line 109:
//        const { ..., version, ... } = globalThis.pdfjsLib;
//    The PDFViewer constructor (line 7700-7704) then compares:
//        const viewerVersion = "5.4.530";
//        if (version !== viewerVersion) throw ...
//  - `build/pdf.mjs` line 26330 sets `globalThis.pdfjsLib = { version: "5.4.530", ... }`
//    as a side effect at module init.
//  - Obsidian's `obsidian.asar` bundles its OWN pdfjs v5.3.34 and ALSO writes
//    `globalThis.pdfjsLib = { version: "5.3.34", ... }` (confirmed: `strings
//    obsidian.asar | grep pdfjsVersion` → "5.3.34"). If Obsidian's assignment
//    wins the init race, our viewer module's destructure captures "5.3.34" →
//    the constructor throws "API version 5.3.34 does not match Viewer 5.4.530".
//
// FIX: this shim is a side-effect module imported FIRST in pdf-view.ts, BEFORE
// `pdfjs-dist/web/pdf_viewer.mjs`. ES module init runs side-effect imports in
// source order, so:
//   1. this shim imports our 5.4.530 API (`build/pdf.mjs`), which sets
//      `globalThis.pdfjsLib = { version: "5.4.530", ... }`;
//   2. this shim then RE-asserts `globalThis.pdfjsLib = pdfjsLib` explicitly,
//      so even if Obsidian's 5.3.34 assignment interleaved after step 1, we
//      overwrite it with 5.4.530 immediately;
//   3. only THEN does `pdfjs-dist/web/pdf_viewer.mjs` evaluate and destructure
//      `version` from `globalThis.pdfjsLib` → captures "5.4.530".
//
// Verified in Node (stubs for DOMMatrix/window/document, mimicking Obsidian's
// Electron renderer): with `globalThis.pdfjsLib` pre-set to 5.3.34, requiring
// the rebuilt bundle leaves `globalThis.pdfjsLib.version === "5.4.530"` after
// load — the `build/pdf.mjs` assignment at main.js line ~25797 runs before the
// viewer destructure at ~25870. This shim makes that ordering explicit and
// race-free instead of relying on esbuild's topological sort.
//
// This is the same logical package (pdfjs-dist 5.4.530 API + 5.4.530 viewer);
// aligning the string guard is safe. We do NOT touch the viewer's check logic
// in node_modules (lost on reinstall); we only normalize the ambient global it
// reads.
import * as pdfjsLib from "pdfjs-dist";

// Re-assert before the viewer module touches the global. Assignment is
// unconditional: same object identity either way, just guarantees the version
// string is ours. Cast through `any` — `globalThis.pdfjsLib` is set by pdfjs
// at runtime and has no TS index signature on `typeof globalThis`.
const g = globalThis as unknown as { pdfjsLib?: { version?: string } };
g.pdfjsLib = pdfjsLib as unknown as { version?: string };

// eslint-disable-next-line no-console
console.info(
  `[shiyue] pdfjs-version-shim: globalThis.pdfjsLib.version = ${pdfjsLib.version}`,
);
