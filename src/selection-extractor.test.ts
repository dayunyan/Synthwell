import { test } from "node:test";
import assert from "node:assert";
import { SelectionExtractor } from "./selection-extractor.ts";
import type { LLMProvider, ChatMsg } from "./llm-service.ts";

test("SelectionExtractor.extract: 组装 prompt(选中+上下文+已有标题+书名)→ 解析单点", async () => {
  let captured = "";
  const llm: LLMProvider = {
    async chat(msgs: ChatMsg[]) { captured = msgs[0].content ?? msgs[msgs.length-1].content; return JSON.stringify({ title: "飞轮效应", summary: "正向循环让强者愈强。", source_page: 3, tags: ["增长", "飞轮"], related: [{ title: "网络效应", reason: "都讲平台价值随用户增长" }] }); },
    async *stream() { throw new Error("no"); }, abort() {},
  };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("增长策略.pdf", "飞轮效应是指业务各环节互相强化", 3, "第1页…第2页…第3页…第4页…第5页", ["网络效应", "好战略坏战略"]);
  assert.ok(pt);
  assert.equal(pt!.title, "飞轮效应");
  assert.equal(pt!.source_page, 3);
  assert.deepEqual(pt!.tags, ["增长", "飞轮"]);
  assert.equal(pt!.related.length, 1);
  assert.equal(pt!.related[0].title, "网络效应");
  assert.ok(captured.includes("增长策略.pdf"), "书名入 prompt");
  assert.ok(captured.includes("飞轮效应是指业务各环节互相强化"), "选中段入 prompt");
  assert.ok(captured.includes("第3页"), "上下文入 prompt");
  assert.ok(captured.includes("网络效应"), "已有标题入 prompt");
});

test("SelectionExtractor.extract: LLM 返回非 JSON → 返回 null(不抛)", async () => {
  const llm: LLMProvider = { async chat() { return "这不是 JSON"; }, async *stream() { throw 0; }, abort() {} };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("b.pdf", "选中", 1, "上下文", []);
  assert.equal(pt, null);
});

test("SelectionExtractor.extract: 把点包在对象里 {point:{...}} → 抠出来", async () => {
  const llm: LLMProvider = { async chat() { return JSON.stringify({ point: { title: "点A", summary: "s", source_page: 1, tags: [], related: [] } }); }, async *stream() { throw 0; }, abort() {} };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("b.pdf", "选中", 1, "上下文", []);
  assert.ok(pt && pt.title === "点A");
});

test("SelectionExtractor.extract: 缺 title 或 related 非数组 → 归一,不炸", async () => {
  const llm: LLMProvider = { async chat() { return JSON.stringify({ summary: "s", source_page: "5", tags: "x", related: null }); }, async *stream() { throw 0; }, abort() {} };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("b.pdf", "选中", 2, "上下文", []);
  assert.equal(pt, null);  // 无 title → 丢弃
});
