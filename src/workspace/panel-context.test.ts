import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyContext, synthesisSourceCount } from "./panel-context.ts";

const pdf = { extension: "pdf" } as any;
const kp = (ext = "md") => ({ extension: ext } as any);
const fm = (t?: string) => (t ? { shiyue_type: t } : {}) as any;

test("classifyContext: null 文件 → none", () => {
  assert.equal(classifyContext(null, fm("knowledge_point")), "none");
});

test("classifyContext: PDF → pdf", () => {
  assert.equal(classifyContext(pdf, null), "pdf");
});

test("classifyContext: md + shiyue_type=knowledge_point → knowledge-point", () => {
  assert.equal(classifyContext(kp(), fm("knowledge_point")), "knowledge-point");
});

test("classifyContext: md 但 shiyue_type 非 knowledge_point → none(普通 md 禁用)", () => {
  assert.equal(classifyContext(kp(), fm("other")), "none");
  assert.equal(classifyContext(kp(), fm()), "none");
});

test("classifyContext: md 无 frontmatter → none", () => {
  assert.equal(classifyContext(kp(), null), "none");
});

test("classifyContext: 其它扩展名(如 canvas/json)→ none", () => {
  assert.equal(classifyContext({ extension: "canvas" } as any, null), "none");
});

test("classifyContext: md + 遗留 synthwell_type=knowledge_point → knowledge-point(Bug 4 回归)", () => {
  // #03 改名前生成的笔记用 synthwell_type;classifyContext 须兼容,否则面板误判 none。
  const legacyFm = { synthwell_type: "knowledge_point" } as any;
  assert.equal(classifyContext(kp(), legacyFm), "knowledge-point");
  // 新旧键同时存在:任一为 knowledge_point 即认。
  assert.equal(classifyContext(kp(), { shiyue_type: "knowledge_point", synthwell_type: "knowledge_point" } as any), "knowledge-point");
});

// ---- synthesis kind(#03:综合笔记 = 独立图谱节点 shiyue_type=synthesis)----
test("classifyContext: md + shiyue_type=synthesis → synthesis(优先于 knowledge-point)", () => {
  assert.equal(classifyContext(kp(), fm("synthesis")), "synthesis");
  // 即便两类型键同时存在(不应发生),synthesis 优先(综合笔记是聚合层,非知识点叶)
  assert.equal(classifyContext(kp(), { shiyue_type: "synthesis", synthwell_type: "knowledge_point" } as any), "synthesis");
});

test("classifyContext: synthesis kind 不与 pdf 冲突(PDF 无视 frontmatter → pdf)", () => {
  // PDF 即便带 shiyue_type=synthesis 仍是 pdf(综合笔记只可能是 md)
  assert.equal(classifyContext(pdf, fm("synthesis")), "pdf");
});

test("classifyContext: synthesis 不认遗留 synthwell_type(改名前不可能生成 synthesis)", () => {
  // 与 knowledge_point 的 Bug4 兼容不同源:synthesis 是 ADR-0006 后才有的类型,只认规范键。
  assert.equal(classifyContext(kp(), { synthwell_type: "synthesis" } as any), "none");
});

// ---- synthesisSourceCount:综合笔记信息提示 N = synthesized_from 长度(#03)----
test("synthesisSourceCount: synthesized_from 数组 → 其长度", () => {
  assert.equal(synthesisSourceCount({ shiyue_type: "synthesis", synthesized_from: ["[[a]]", "[[b]]", "[[c]]"] }), 3);
});

test("synthesisSourceCount: synthesized_from 空数组 → 0", () => {
  assert.equal(synthesisSourceCount({ shiyue_type: "synthesis", synthesized_from: [] }), 0);
});

test("synthesisSourceCount: synthesized_from 缺失 → 0", () => {
  assert.equal(synthesisSourceCount({ shiyue_type: "synthesis" }), 0);
  assert.equal(synthesisSourceCount(null), 0);
});

test("synthesisSourceCount: synthesized_from 非数组(畸形)→ 0(不炸)", () => {
  assert.equal(synthesisSourceCount({ synthesized_from: "[[a]]" } as any), 0);
  assert.equal(synthesisSourceCount({ synthesized_from: { x: 1 } } as any), 0);
});
