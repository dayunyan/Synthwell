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

import { jaccard, dedupe } from "./batch-extractor.ts";
import type { BatchPoint } from "./batch-extractor.ts";

test("jaccard: 完全相同 = 1;无交集 = 0", () => {
  assert.equal(jaccard("飞轮效应", "飞轮效应"), 1);
  assert.equal(jaccard("abc", "xyz"), 0);
  assert.ok(jaccard("飞轮效应在 SaaS", "飞轮效应在电商") > 0.5);
});
test("dedupe: 标题相似 >0.8 合并(保留更全 summary + 合并 related/tags)", () => {
  const points: BatchPoint[] = [
    { title: "飞轮效应", summary: "短", source_page: 1, tags: ["增长"], related: ["网络效应"] },
    { title: "飞轮效应", summary: "更完整的飞轮说明", source_page: 5, tags: ["飞轮"], related: ["好战略"] },
    { title: "网络效应", summary: "x", source_page: 10, tags: ["平台"], related: [] },
  ];
  const out = dedupe(points, 0.8);
  assert.equal(out.length, 2);
  const feilun = out.find(p => p.title.includes("飞轮"))!;
  assert.equal(feilun.summary, "更完整的飞轮说明");
  assert.ok(feilun.tags.includes("增长") && feilun.tags.includes("飞轮"));
  assert.ok(feilun.related.includes("网络效应") && feilun.related.includes("好战略"));
});
test("dedupe: 标题不同都保留", () => {
  const out = dedupe([{ title: "A", summary: "s", source_page: 1, tags: [], related: [] }, { title: "B", summary: "s", source_page: 2, tags: [], related: [] }], 0.8);
  assert.equal(out.length, 2);
});
