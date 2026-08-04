// src/document-source.test.ts
import { test } from "node:test";
import assert from "node:assert";
import type { DocumentSource } from "./document-source.ts";

test("DocumentSource 接口形状:getFile/getDocument/getSelection", () => {
  // 用一个最小 mock 实现验证接口形状
  const ds: DocumentSource = {
    getFile: () => ({ name: "x.pdf", path: "x.pdf", basename: "x", extension: "pdf" } as any),
    getDocument: async () => null,
    getSelection: () => null,
  };
  assert.equal(ds.getFile().basename, "x");
  assert.equal(ds.getSelection(), null);
});

test("PdfDocumentSource.getSelection 恒为 null(文件源无选区;选区走 view)", async () => {
  const { PdfDocumentSource } = await import("./document-source.ts");
  // 不依赖真 Obsidian/pdfjs——只验 getSelection 的 null 语义 + getFile 透传
  const ds = new PdfDocumentSource({ basename: "x", path: "x.pdf", extension: "pdf" } as any, null as any, null as any);
  assert.equal(ds.getSelection(), null);
  assert.equal(ds.getFile().path, "x.pdf");
});
