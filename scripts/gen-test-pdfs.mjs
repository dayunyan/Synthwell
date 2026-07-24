// Generates large test PDFs for the W0 spike's E2 (virtual scroll) / E3
// (onClose memory) verification. The survey paper is only 9 pages — too small
// to stress virtual scrolling or observe memory growth. We merge it up to
// ~200 and ~800 pages. Content doesn't matter for perf/memory testing; page
// count does.
//
// Run:  node scripts/gen-test-pdfs.mjs
//
// Output (gitignored — test-vault/ is in .gitignore, and the PDFs are huge):
//   test-vault/SHIYUE-TEST-200p.pdf   (~207 pages: 200/9 ≈ 23 copies)
//   test-vault/SHIYUE-TEST-800p.pdf   (~801 pages: 800/9 ≈ 89 copies)
//
// If the source PDF can't be loaded (encryption/parse), falls back to blank
// pages — page count is what matters, not content.

import { PDFDocument } from "pdf-lib";
import { readFileSync, writeFileSync } from "fs";

const SRC = "test-vault/A Survey of Self-Evolving Agents- On Path to Artificial Super Intelligence.pdf";

async function repeatMerge(target, out) {
  const srcBytes = readFileSync(SRC);
  const outDoc = await PDFDocument.create();

  let added = 0;
  let srcDoc;
  try {
    srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  } catch (err) {
    console.warn(`[gen] source load failed (${err.message}), falling back to blank pages`);
  }

  if (srcDoc) {
    const srcPages = srcDoc.getPages();
    const perCopy = srcPages.length;
    console.log(`[gen] source has ${perCopy} pages; target ${target}`);
    while (added < target) {
      const want = Math.min(perCopy, target - added);
      // copyPages wants the source doc + indices; re-use indices [0..want-1].
      const copied = await outDoc.copyPages(srcDoc, [...Array(want).keys()]);
      copied.forEach((pg) => outDoc.addPage(pg));
      added += want;
    }
  } else {
    while (added < target) {
      outDoc.addPage();
      added++;
    }
  }

  const bytes = await outDoc.save();
  writeFileSync(out, bytes);
  console.log(`[gen] wrote ${out} (${outDoc.getPageCount()} pages, ${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
}

await repeatMerge(200, "test-vault/SHIYUE-TEST-200p.pdf");
await repeatMerge(800, "test-vault/SHIYUE-TEST-800p.pdf");
