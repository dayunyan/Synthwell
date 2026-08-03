import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSynthesisNoteContent, resolveSynthesisPath, type BuildSynthesisNoteInput } from "./synthesis-note.ts";
import type { KnowledgeNote } from "./synthesizer.ts";

/** 造 KnowledgeNote(默认值与 synthesizer.test.ts 的 note() 同形)。 */
function note(o: Partial<KnowledgeNote>): KnowledgeNote {
  return {
    title: o.title ?? "飞轮",
    summary: o.summary ?? "s",
    source_pdf: o.source_pdf ?? "书.pdf",
    source_page: o.source_page ?? 1,
    source_text: o.source_text ?? "原文",
    tags: o.tags ?? [],
    related: o.related ?? [],
  };
}

const BASE_INPUT: BuildSynthesisNoteInput = {
  triggerTitle: "飞轮",
  sources: [note({ title: "飞轮", tags: ["增长"] })],
  synthesisMd: "综合:飞轮与网络效应 [[网络效应]](p3)。",
  model: "deepseek-v4-flash",
  synthesizedAt: "2026-08-03",
};

// ── frontmatter:字段齐全 + 类型 ─────────────────────────────────────────────

test("buildSynthesisNoteContent: frontmatter 含 shiyue_type=synthesis + synthesized_at + model", () => {
  const md = buildSynthesisNoteContent(BASE_INPUT);
  assert.ok(md.startsWith("---\n"), "以 frontmatter 开");
  assert.ok(md.includes("shiyue_type: synthesis"), "类型 synthesis");
  assert.ok(md.includes("synthesized_at: 2026-08-03"), "synthesized_at 注入");
  assert.ok(md.includes("model: deepseek-v4-flash"), "model 注入");
});

test("buildSynthesisNoteContent: 无 ## 原文 / ## 关联 块(综合笔记专属,非知识点)", () => {
  const md = buildSynthesisNoteContent(BASE_INPUT);
  assert.ok(!/^##\s+原文\s*$/m.test(md), "无 ## 原文");
  assert.ok(!/^##\s+关联\s*$/m.test(md), "无 ## 关联");
});

// ── synthesized_from:双链列表 ───────────────────────────────────────────────

test("buildSynthesisNoteContent: synthesized_from = 源 KP [[title]] 双链列表(含触发 KP + 关联)", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [
      note({ title: "飞轮", tags: ["增长"] }),
      note({ title: "网络效应", tags: ["平台"] }),
      note({ title: "好战略坏战略", tags: ["战略"] }),
    ],
  });
  assert.ok(md.includes("synthesized_from:"), "有 synthesized_from 键");
  assert.ok(md.includes("  - [[飞轮]]"), "含触发 KP 双链");
  assert.ok(md.includes("  - [[网络效应]]"), "含关联 KP 双链");
  assert.ok(md.includes("  - [[好战略坏战略]]"), "含关联 KP 双链");
});

test("buildSynthesisNoteContent: synthesized_from 按源列表顺序(触发在前,关联按给定序)", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [
      note({ title: "飞轮" }),
      note({ title: "网络效应" }),
      note({ title: "锁定效应" }),
    ],
  });
  const i1 = md.indexOf("[[飞轮]]");
  const i2 = md.indexOf("[[网络效应]]");
  const i3 = md.indexOf("[[锁定效应]]");
  assert.ok(i1 < i2 && i2 < i3, "双链按源列表顺序");
});

test("buildSynthesisNoteContent: synthesized_from 去重(同名源只一条)", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    synthesisMd: "综合摘要(不含双链)。",  // 排除 body 双链干扰,只验 frontmatter 去重
    sources: [
      note({ title: "飞轮" }),
      note({ title: "飞轮" }),  // 同名重复(理论不会发生,但去重保稳)
      note({ title: "网络效应" }),
    ],
  });
  // 只取 frontmatter 段验 synthesized_from 去重(避免 body 里 [[笔记]] 溯源双链混入计数)
  const fm = md.slice(0, md.indexOf("---", 3));
  assert.equal((fm.match(/\[\[飞轮\]\]/g) ?? []).length, 1, "同名双链去重");
  assert.equal((fm.match(/\[\[网络效应\]\]/g) ?? []).length, 1);
});

test("buildSynthesisNoteContent: 空源(仅触发)→ synthesized_from 仅触发一条", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [note({ title: "飞轮" })],
  });
  assert.ok(md.includes("synthesized_from:"));
  assert.ok(md.includes("  - [[飞轮]]"));
  assert.equal((md.match(/  - \[\[/g) ?? []).length, 1, "仅一条双链");
});

// ── tags:源 KP tags 去重并集 ────────────────────────────────────────────────

test("buildSynthesisNoteContent: tags = 全部源 KP tags 去重并集", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [
      note({ title: "飞轮", tags: ["增长", "飞轮效应"] }),
      note({ title: "网络效应", tags: ["增长", "平台"] }),
      note({ title: "锁定效应", tags: ["平台", "切换成本"] }),
    ],
  });
  assert.ok(md.includes("tags:"));
  assert.ok(md.includes("  - 增长"));
  assert.ok(md.includes("  - 飞轮效应"));
  assert.ok(md.includes("  - 平台"));
  assert.ok(md.includes("  - 切换成本"));
  // 去重:增长 / 平台 各只一次
  assert.equal((md.match(/  - 增长$/gm) ?? []).length, 1, "增长去重");
  assert.equal((md.match(/  - 平台$/gm) ?? []).length, 1, "平台去重");
});

test("buildSynthesisNoteContent: tags 去重大小写不敏感,保留首次出现的原大小写", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [
      note({ title: "a", tags: ["SaaS"] }),
      note({ title: "b", tags: ["saas"] }),  // 大小写不同但同 tag
    ],
  });
  assert.equal((md.match(/  - SaaS$/gm) ?? []).length, 1, "保留首次大小写 SaaS");
  assert.equal((md.match(/  - saas$/gm) ?? []).length, 0, "大小写变体去重");
});

test("buildSynthesisNoteContent: 全源无 tags → tags: []", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [note({ title: "飞轮", tags: [] })],
  });
  assert.ok(/^tags:\s*\[\]\s*$/m.test(md), "空 tags 用 [] (与 renderNote 同模式)");
});

// ── body:标题 + synthesis 原样 ──────────────────────────────────────────────

test("buildSynthesisNoteContent: body = # 汇总 - <trigger title> + synthesis 原样", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    triggerTitle: "飞轮效应",
    synthesisMd: "综合摘要正文 [[网络效应]](p3)。",
  });
  assert.ok(md.includes("# 汇总 - 飞轮效应"), "正文 H1 = 汇总 - <trigger title>");
  assert.ok(md.includes("综合摘要正文 [[网络效应]](p3)。"), "synthesis 原样保留(含 [[笔记]](pN) 溯源)");
});

test("buildSynthesisNoteContent: synthesis 末尾多换行 → 收敛为单换行", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    synthesisMd: "综合。\n\n\n",
  });
  assert.ok(md.endsWith("综合。\n"), "末尾收敛为单换行");
  assert.ok(!md.includes("综合。\n\n\n"), "无三连换行");
});

test("buildSynthesisNoteContent: 空 synthesis 亦可存(标题 + 空 body,不抛)", () => {
  const md = buildSynthesisNoteContent({ ...BASE_INPUT, synthesisMd: "" });
  assert.ok(md.includes("# 汇总 - 飞轮"), "仍含标题");
  assert.ok(md.endsWith("\n"), "以换行收尾");
});

// ── frontmatter YAML 转义(对照 renderNote 先例)──────────────────────────────

test("buildSynthesisNoteContent: tag 含双引号 → YAML 行内转义为单行标量(不影响结构)", () => {
  // tag 含双引号:YAML 列表项 `- "..."` 包裹更稳;此处验列表项不破坏 frontmatter 闭合。
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    sources: [note({ title: "飞轮", tags: ['含"引号"的tag'] })],
  });
  // frontmatter 必须仍闭合(body # 标题在第二个 --- 之后)
  const fmEnd = md.indexOf("---", 3);
  assert.ok(fmEnd > 0, "frontmatter 闭合");
  assert.ok(md.slice(0, fmEnd).includes("含"), "tag 内容保留");
  assert.ok(md.slice(fmEnd).includes("# 汇总 - 飞轮"), "body 在 frontmatter 之后");
});

test("buildSynthesisNoteContent: trigger title 含特殊字符 → 标题原样(不破坏 H1 行)", () => {
  const md = buildSynthesisNoteContent({
    ...BASE_INPUT,
    triggerTitle: "飞轮 & 网络效应",
  });
  assert.ok(md.includes("# 汇总 - 飞轮 & 网络效应"), "特殊字符标题原样");
});

// ── 幂等结构(重汇总 = 全替换,seam 每次产完整内容)────────────────────────────

test("buildSynthesisNoteContent: 同输入两次产出一致(重汇总 seam 幂等)", () => {
  const a = buildSynthesisNoteContent(BASE_INPUT);
  const b = buildSynthesisNoteContent(BASE_INPUT);
  assert.equal(a, b, "纯 seam 同输入 → 同输出");
});

// ── resolveSynthesisPath ────────────────────────────────────────────────────

test("resolveSynthesisPath: <synthesisPath>/汇总 - <basename>.md", () => {
  assert.equal(
    resolveSynthesisPath("飞轮", "拾阅笔记/汇总"),
    "拾阅笔记/汇总/汇总 - 飞轮.md",
  );
});

test("resolveSynthesisPath: synthesisPath 带尾斜杠 → 不重复斜杠", () => {
  assert.equal(
    resolveSynthesisPath("飞轮", "拾阅笔记/汇总/"),
    "拾阅笔记/汇总/汇总 - 飞轮.md",
  );
});

test("resolveSynthesisPath: basename 含空格/特殊字符 → 原样(TFile basename 已合法)", () => {
  // TFile.basename 是文件系统已合法的文件名;seam 不再 sanitize(与 note-generator 的
  // sanitizeTitle 不同——那是对 AI 产 title sanitize 后才作文件名;此处 basename 已是文件名)。
  assert.equal(
    resolveSynthesisPath("飞轮效应 SaaS", "拾阅笔记/汇总"),
    "拾阅笔记/汇总/汇总 - 飞轮效应 SaaS.md",
  );
});

test("resolveSynthesisPath: 稳定文件名(同 basename 多次调同结果 → 重汇总覆盖同路径)", () => {
  const a = resolveSynthesisPath("飞轮", "拾阅笔记/汇总");
  const b = resolveSynthesisPath("飞轮", "拾阅笔记/汇总");
  assert.equal(a, b, "文件名稳定(覆盖语义靠此)");
});
