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

import { BatchExtractor } from "./batch-extractor.ts";
import type { LLMProvider, ChatMsg } from "./llm-service.ts";

test("extractChunk: 调 LLM + 解析 JSON 数组 + 注入前文知识点", async () => {
  let captured = "";
  const llm: LLMProvider = {
    async chat(msgs: ChatMsg[]) { captured = msgs[0].content ?? msgs[msgs.length-1].content; return JSON.stringify([{ title: "飞轮效应", summary: "正向循环", source_page: 3, tags: ["增长"], related: ["网络效应"] }]); },
    async *stream() { throw new Error("no"); }, abort() {},
  };
  const be = new BatchExtractor({} as any, llm, {} as any, { notesPath: "x", model: "m" } as any, { inputPer1M: 1, outputPer1M: 2 });
  const prior = [{ title: "网络效应", summary: "平台价值随用户增长" }];
  const pts = await be.extractChunk("书.pdf", { text: "飞轮效应是指…", pages: [3, 4] }, prior);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].title, "飞轮效应");
  assert.ok(captured.includes("网络效应"), "前文知识点应注入 prompt");
  assert.ok(captured.includes("飞轮效应是指"), "块文本应注入 prompt");
  assert.ok(captured.includes("书.pdf"));
});
test("extractChunk: LLM 返回非 JSON → 返回空数组(不抛)", async () => {
  const llm: LLMProvider = { async chat() { return "这不是 JSON"; }, async *stream() { throw 0; }, abort() {} };
  const be = new BatchExtractor({} as any, llm, {} as any, { notesPath: "x", model: "m" } as any, { inputPer1M: 1, outputPer1M: 2 });
  const pts = await be.extractChunk("b.pdf", { text: "t", pages: [1] }, []);
  assert.equal(pts.length, 0);
});
