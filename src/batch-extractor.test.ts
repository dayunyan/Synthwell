import { test } from "node:test";
import assert from "node:assert";
import { chunkPages } from "./batch-extractor.ts";

test("chunkPages: 单块(页文本 < budget)整本一页一页合", () => {
  const pages = [{ page: 1, text: "短文本" }, { page: 2, text: "也短" }];
  const chunks = chunkPages(pages, 3000, 200);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "短文本也短");
  assert.deepEqual(chunks[0].pages, [1, 2]);
});
test("chunkPages: 超 budget 切多块,页对齐(不跨页切)", () => {
  const pages = [
    { page: 1, text: "a".repeat(16) },
    { page: 2, text: "b".repeat(16) },
    { page: 3, text: "c".repeat(16) },
  ];
  const chunks = chunkPages(pages, 8, 0);
  assert.ok(chunks.length >= 2, "应切多块");
  for (const c of chunks) assert.equal(c.pages.length > 0, true);
  const allPages = chunks.flatMap(c => c.pages);
  assert.deepEqual([...new Set(allPages)].sort(), [1, 2, 3]);
});
test("chunkPages: 空文档 → 0 块", () => {
  assert.equal(chunkPages([], 3000, 200).length, 0);
});
