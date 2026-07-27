import { test } from "node:test";
import assert from "node:assert";
import { sanitizeTitle, renderNote } from "./note-generator.ts";

test("sanitizeTitle: 保留 CJK + 去非法字符 + 截断 80", () => {
  assert.equal(sanitizeTitle("飞轮效应在 SaaS 中的应用"), "飞轮效应在 SaaS 中的应用");
  assert.equal(sanitizeTitle("a/b:c*d?e\"f<g>h|i"), "abcdefghi");
  assert.equal(sanitizeTitle("  前后空格  "), "前后空格");
  const long = "字".repeat(100); assert.equal(sanitizeTitle(long).length, 80);
});

test("renderNote: schema 正确(frontmatter + 原文完整 + 关联 backlink)", () => {
  const md = renderNote({
    title: "飞轮效应", summary: "正向循环让强者愈强。",
    source_pdf: "增长策略.pdf", source_page: 42, source_text: "飞轮效应是指…(完整原文)",
    tags: ["飞轮效应", "增长"], related: ["网络效应", "好战略坏战略"],
    model: "deepseek-v4-flash", extraction_mode: "batch",
  }, "2026-07-27");
  assert.ok(md.startsWith("---\n"));
  assert.ok(md.includes("synthwell_type: knowledge_point"));
  assert.ok(md.includes('source_pdf: "[[增长策略.pdf]]"'));
  assert.ok(md.includes("source_page: 42"));
  assert.ok(md.includes("source_text:"));
  assert.ok(md.includes("extracted_at: 2026-07-27"));
  assert.ok(md.includes("# 飞轮效应"));
  assert.ok(md.includes("正向循环让强者愈强。"));
  assert.ok(md.includes("## 原文"));
  assert.ok(md.includes("> 飞轮效应是指…(完整原文)"));
  assert.ok(md.includes("- [[网络效应]]"));
  assert.ok(md.includes("  - 飞轮效应"));
});

test("renderNote: frontmatter source_text 截断 ~200,body 原文完整", () => {
  const full = "字".repeat(500);
  const md = renderNote({ title: "t", summary: "s", source_pdf: "b.pdf", source_page: 1, source_text: full, tags: [], related: [], model: "m", extraction_mode: "batch" }, "2026-07-27");
  const fmMatch = md.match(/source_text:\s*"(.*?)"/s);
  assert.ok(fmMatch && fmMatch[1].length <= 203);
  assert.ok(md.includes(`> ${full}`));
});
