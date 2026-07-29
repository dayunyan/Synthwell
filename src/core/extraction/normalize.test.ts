import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTag, splitTag, normalizePoint } from "./normalize.ts";

test("sanitizeTag: CJK 原样保留", () => {
  assert.equal(sanitizeTag("机器学习"), "机器学习");
});
test("sanitizeTag: 去首 #", () => {
  assert.equal(sanitizeTag("#增长"), "增长");
});
test("sanitizeTag: 内部空格→_", () => {
  assert.equal(sanitizeTag("machine learning"), "machine_learning");
});
test("sanitizeTag: 标点→_ 并合并/去首尾", () => {
  assert.equal(sanitizeTag("增长!策略"), "增长_策略");
  assert.equal(sanitizeTag("a,,b"), "a_b");
  assert.equal(sanitizeTag("  飞轮 效应  "), "飞轮_效应");
});
test("sanitizeTag: 空/纯标点 → 空串", () => {
  assert.equal(sanitizeTag(""), "");
  assert.equal(sanitizeTag(",,,,"), "");
  assert.equal(sanitizeTag(null as any), "");
});
test("sanitizeTag: 截长 100", () => {
  assert.equal(sanitizeTag("a".repeat(150)).length, 100);
});

test("splitTag: 拆列表分隔符(逗号/顿号/分号/斜杠)", () => {
  assert.deepEqual(splitTag("机器学习, NLP"), ["机器学习", "NLP"]);
  assert.deepEqual(splitTag("a/b、c；d"), ["a", "b", "c", "d"]);
});
test("splitTag: 非字符串 → []", () => {
  assert.deepEqual(splitTag(null), []);
  assert.deepEqual(splitTag(123 as any), []);
});

test("normalizePoint: tags 拆+清+去重", () => {
  const p = normalizePoint({ title: "T", summary: "s", source_page: 1,
    tags: ["机器学习, NLP", "#增长", "飞轮 效应", "增长", null, 123] }, 1);
  assert.deepEqual(p!.tags, ["机器学习", "NLP", "增长", "飞轮_效应"]);
});
test("normalizePoint: tags 缺/非数组 → []", () => {
  assert.deepEqual(normalizePoint({ title: "T" }, 1)!.tags, []);
  assert.deepEqual(normalizePoint({ title: "T", tags: "x" }, 1)!.tags, []);
});

test("normalizePoint: related 为 {title,reason}[] 时保留(title+reason)", () => {
  const p = normalizePoint({ title: "T", related: [{ title: "网络效应", reason: "都讲平台价值" }, { title: "飞轮", reason: "" }] }, 1);
  assert.deepEqual(p!.related, [{ title: "网络效应", reason: "都讲平台价值" }, { title: "飞轮", reason: "" }]);
});

test("normalizePoint: related 退化——LLM 仍返纯标题字符串 → {title, reason:''}", () => {
  const p = normalizePoint({ title: "T", related: ["网络效应", "  飞轮  ", ""] }, 1);
  assert.deepEqual(p!.related, [{ title: "网络效应", reason: "" }, { title: "飞轮", reason: "" }]);
});

test("normalizePoint: related 缺/非数组/残项 → []", () => {
  assert.deepEqual(normalizePoint({ title: "T" }, 1)!.related, []);
  assert.deepEqual(normalizePoint({ title: "T", related: null }, 1)!.related, []);
  assert.deepEqual(normalizePoint({ title: "T", related: "x" }, 1)!.related, []);
  // 残项:无 title 的对象、非对象、空标题 → 丢弃;reason 非 string → ""
  const p = normalizePoint({ title: "T", related: [{ reason: "无标题" }, 123, { title: "  ", reason: "x" }, { title: "好", reason: 9 }] }, 1);
  assert.deepEqual(p!.related, [{ title: "好", reason: "" }]);
});
