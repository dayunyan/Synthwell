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
  assert.ok(md.includes("shiyue_type: knowledge_point"));
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

test("renderNote: source_text 含反斜杠/双引号/换行 → YAML 转义,frontmatter 仍可解析", () => {
  // 末尾反斜杠会吞掉闭合引号导致 frontmatter 炸裂(回归 nit #3)
  const md = renderNote({ title: "t", summary: "s", source_pdf: "b.pdf", source_page: 1, source_text: '路径 C:\\dir 与 "引用"\n第二行\\', tags: [], related: [], model: "m", extraction_mode: "batch" }, "2026-07-27");
  const fmMatch = md.match(/source_text:\s*"(.*?)"\n/s);
  assert.ok(fmMatch, "source_text 行应为完整可匹配的双引号标量");
  // 反斜杠被转义为 \\(每个 \ → \\)
  assert.ok(fmMatch![1].includes("C:\\\\dir"));
  assert.ok(!fmMatch![1].includes('\\"引用"'), "双引号应被转义,不应出现未转义的成对引号");
  assert.ok(!fmMatch![1].includes("\n"), "换行应被替换为空格");
  // body 原文完整未转义
  assert.ok(md.includes('> 路径 C:\\dir 与 "引用"'));
});

test("NoteGenerator.generate: 标题冲突 → -2/-3", async () => {
  const created: string[] = [];
  const existing = new Set<string>(["拾阅笔记/知识点/书.pdf/飞轮效应.md"]);  // 第一个已存在
  const adapter = {
    async exists(path: string) { return existing.has(path); },
    async read() { return ""; },
    async write(path: string) { created.push(path); existing.add(path); },
    async mkdir(path: string) { existing.add(path); },  // mkdir 后该路径视为存在
  } as any;
  const { NoteGenerator } = await import("./note-generator.ts");
  const gen = new NoteGenerator(adapter as any, { notesPath: "拾阅笔记/知识点", model: "deepseek-v4-flash" });
  const p = { title: "飞轮效应", summary: "s", source_pdf: "书.pdf", source_page: 1, source_text: "原文", tags: ["飞轮"], related: [], model: "deepseek-v4-flash", extraction_mode: "batch" as const };
  await gen.generate(p);   // 基名已存在 → 用 -2
  await gen.generate(p);   // -2 现也存在 → 用 -3
  assert.equal(created.length, 2);
  assert.ok(created[0].endsWith("/飞轮效应 - 2.md"), `第一次应写 -2,实际:${created[0]}`);
  assert.ok(created[1].endsWith("/飞轮效应 - 3.md"), `第二次应写 -3,实际:${created[1]}`);
});

test("NoteGenerator.generate: 嵌套文件夹逐级 mkdir(真实 adapter.mkdir 单层,不递归)", async () => {
  // 回归生产 ENOENT:DataAdapter.mkdir 单层,须手动建中间目录,否则 write 报 no such file or directory
  const mkdirs: string[] = [];
  const existing = new Set<string>();  // 全空 → 每一级都不存在
  const adapter = {
    async exists(path: string) { return existing.has(path); },
    async read() { return ""; },
    async write(path: string) { existing.add(path); },
    async mkdir(path: string) { mkdirs.push(path); existing.add(path); },
  } as any;
  const { NoteGenerator } = await import("./note-generator.ts");
  const gen = new NoteGenerator(adapter as any, { notesPath: "拾阅笔记/知识点", model: "m" });
  await gen.generate({ title: "飞轮", summary: "s", source_pdf: "书.pdf", source_page: 1, source_text: "原文", tags: [], related: [], model: "m", extraction_mode: "batch" });
  // 三级目录都不存在 → 逐级 mkdir
  assert.deepEqual(mkdirs, ["拾阅笔记", "拾阅笔记/知识点", "拾阅笔记/知识点/书.pdf"]);
});

test("renderNote: 有 related_reasons → ## 关联 显示 [[title]] — reason", () => {
  const md = renderNote({
    title: "飞轮", summary: "s", source_pdf: "b.pdf", source_page: 3, source_text: "原文",
    tags: [], related: ["网络效应"], related_reasons: [{ title: "网络效应", reason: "都讲平台价值" }],
    model: "m", extraction_mode: "selection",
  }, "2026-07-27");
  assert.ok(md.includes("- [[网络效应]] — 都讲平台价值"));
  assert.ok(md.includes('  - "[[网络效应]]"'));  // frontmatter backlink 仍在
});

test("renderNote: 无 related_reasons(批处理)→ ## 关联 纯 backlink,向后兼容", () => {
  const md = renderNote({
    title: "飞轮", summary: "s", source_pdf: "b.pdf", source_page: 3, source_text: "原文",
    tags: [], related: ["网络效应", "好战略坏战略"], model: "m", extraction_mode: "batch",
  }, "2026-07-27");
  assert.ok(md.includes("- [[网络效应]]"));
  assert.ok(!md.includes("- [[网络效应]] — "));  // 无 reason 后缀
});
