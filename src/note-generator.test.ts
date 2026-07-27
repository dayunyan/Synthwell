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

test("NoteGenerator.generate: 标题冲突 → -2/-3; 文件夹不存在则创建", async () => {
  const created: string[] = [];
  const exists = (async (path: string) => path.endsWith("/飞轮效应.md")) as any;
  const adapter = {
    exists, async read() { return ""; }, async write(path: string, content: string) { created.push(path); },
  } as any;
  const { NoteGenerator } = await import("./note-generator.ts");
  const gen = new NoteGenerator(adapter as any, { notesPath: "拾阅笔记/知识点", model: "deepseek-v4-flash" });
  const p = { title: "飞轮效应", summary: "s", source_pdf: "书.pdf", source_page: 1, source_text: "原文", tags: ["飞轮"], related: [], model: "deepseek-v4-flash", extraction_mode: "batch" as const };
  await gen.generate(p);
  adapter.exists = (async (path: string) => path.endsWith("/飞轮效应.md") || path.endsWith("/飞轮效应 - 2.md")) as any;
  await gen.generate(p);
  assert.ok(created.length >= 2);
  assert.ok(created.some(p => p.includes("飞轮效应 - 2")) || created.some(p => p.includes("飞轮效应 - 3")));
});
