import { test } from "node:test";
import assert from "node:assert/strict";
import { appendSynthesisSection, SYNTH_SECTION_HEADING } from "./synth-section.ts";

const HEADING = SYNTH_SECTION_HEADING;  // `## 综合汇总`

// ── 章节不存在:文末创建 ────────────────────────────────────────────────────

test("appendSynthesisSection: 无章节 → 文末创建 ## 综合汇总 + 内容", () => {
  const note = ["---", "shiyue_type: knowledge_point", "---", "", "# 飞轮", "", "正向循环。", ""].join("\n");
  const out = appendSynthesisSection(note, "综合:飞轮与网络效应 [[网络效应]](p3)。");
  assert.ok(out.includes(HEADING), "含章节标题");
  assert.ok(out.includes("综合:飞轮与网络效应"), "含 synthesis 内容");
  // 章节标题在末尾(既有内容之后)
  assert.ok(out.indexOf(HEADING) > out.indexOf("正向循环。"), "章节追加在既有内容之后");
});

test("appendSynthesisSection: 无章节且既有内容无尾换行 → 补空行隔开", () => {
  const note = "# 飞轮\n正向循环。";  // 无尾换行
  const out = appendSynthesisSection(note, "综合摘要。");
  assert.ok(out.includes("\n\n" + HEADING), "章节前有空行隔开");
  assert.ok(out.endsWith("\n"), "以单换行收尾");
});

test("appendSynthesisSection: 空 synthesis 亦可存(章节创建)", () => {
  const note = "# 飞轮\n正向循环。";
  const out = appendSynthesisSection(note, "");
  assert.ok(out.includes(HEADING), "含章节标题");
  // 章节标题后无内容(空 synthesis),不抛、不破坏结构
  assert.ok(/## 综合汇总\s*\n\s*$/.test(out), "章节以空内容收尾");
});

// ── 章节已存在:章节内追加 ──────────────────────────────────────────────────

test("appendSynthesisSection: 章节已存在(空,后跟 ## 原文)→ 在章节内、下一 ## 前追加", () => {
  const note = [
    "# 飞轮", "", "正向循环。", "",
    HEADING, "",
    "## 原文", "> 原文片段",
  ].join("\n");
  const out = appendSynthesisSection(note, "综合摘要 A。");
  assert.ok(out.includes("综合摘要 A。"));
  // synthesis 在 `## 综合汇总` 之后、`## 原文` 之前
  const hSynth = out.indexOf(HEADING);
  const hOrig = out.indexOf("## 原文");
  const body = out.indexOf("综合摘要 A。");
  assert.ok(hSynth < body, "synthesis 在章节标题之后");
  assert.ok(body < hOrig, "synthesis 在下一 ## 标题之前");
  assert.equal(out.split(HEADING).length - 1, 1, "不重复创建章节(仅一个标题)");
});

test("appendSynthesisSection: 章节在文末(无后续 ##)→ 文末追加", () => {
  const note = ["# 飞轮", "", HEADING, ""].join("\n");
  const out = appendSynthesisSection(note, "综合摘要 B。");
  assert.ok(out.endsWith("综合摘要 B。\n"), "文末为 synthesis + 换行");
  assert.ok(out.includes("\n\n综合摘要 B。\n"), "synthesis 前有空行");
  assert.equal(out.split(HEADING).length - 1, 1, "不重复创建章节");
});

test("appendSynthesisSection: 章节已有内容 → 追加到既有内容之后(不覆盖)", () => {
  const note = ["# 飞轮", "", HEADING, "", "上一次的综合。", ""].join("\n");
  const out = appendSynthesisSection(note, "新的综合。");
  assert.ok(out.includes("上一次的综合。"), "保留既有 synthesis");
  assert.ok(out.includes("新的综合。"), "含新 synthesis");
  assert.ok(out.indexOf("上一次的综合。") < out.indexOf("新的综合。"), "新内容在旧内容之后");
});

test("appendSynthesisSection: 多次追加 → 累加多块(追加语义,非去重)", () => {
  let note = "# 飞轮\n正向循环。";
  note = appendSynthesisSection(note, "第一块。");
  note = appendSynthesisSection(note, "第二块。");
  assert.ok(note.includes("第一块。"));
  assert.ok(note.includes("第二块。"));
  assert.ok(note.indexOf("第一块。") < note.indexOf("第二块。"), "按追加顺序");
  assert.equal(note.split(HEADING).length - 1, 1, "仅一个章节标题");
});

// ── 边界 ────────────────────────────────────────────────────────────────────

test("appendSynthesisSection: synthesis 末尾多换行 → 收敛为单换行", () => {
  const note = "# 飞轮\n正文。";
  const out = appendSynthesisSection(note, "综合。\n\n\n");
  assert.ok(out.endsWith("综合。\n"), "末尾收敛为单换行");
  assert.ok(!out.includes("综合。\n\n\n"), "无三连换行");
});

test("appendSynthesisSection: 返回值可再次喂入(幂等结构、累加内容)", () => {
  const note = "# 飞轮\n正文。";
  const once = appendSynthesisSection(note, "A。");
  // 再喂一次:输入是上一次输出,应正常处理(章节已存在 → 章节内追加)
  const twice = appendSynthesisSection(once, "B。");
  assert.ok(twice.includes("A。"));
  assert.ok(twice.includes("B。"));
  assert.equal(twice.split(HEADING).length - 1, 1);
});
