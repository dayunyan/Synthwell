import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKnowledgeNote } from "./note-parser.ts";

const FULL = `---
shiyue_type: knowledge_point
source_pdf: "[[增长策略.pdf]]"
source_page: 5
source_text: "飞轮效应截断"
extracted_at: 2026-07-30
model: deepseek-v4-flash
extraction_mode: batch
tags:
  - 增长
  - 平台
related:
  - "[[网络效应]]"
  - "[[好战略]]"
---

# 飞轮效应

正向循环让强者愈强。

## 原文
> 飞轮效应是指推动业务增长的重力加速器,
> 每一圈都在为下一圈蓄能。

## 关联
- [[网络效应]] — 都讲平台正反馈
- [[好战略]]`;

test("parseKnowledgeNote: 标题取自 # 一级标题", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.equal(n.title, "飞轮效应");
});

test("parseKnowledgeNote: source_pdf 去掉 [[]] 与引号", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.equal(n.source_pdf, "增长策略.pdf");
});

test("parseKnowledgeNote: source_page 取 frontmatter 数字", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.equal(n.source_page, 5);
});

test("parseKnowledgeNote: source_text 取 body ## 原文 完整片段(优先于 frontmatter 截断值)", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.ok(n.source_text.includes("每一圈都在为下一圈蓄能"), "取到完整原文");
  assert.ok(!n.source_text.includes("飞轮效应截断"), "不用 frontmatter 的截断 source_text");
});

test("parseKnowledgeNote: summary 取标题与第一个 ## 之间的正文", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.equal(n.summary.trim(), "正向循环让强者愈强。");
});

test("parseKnowledgeNote: tags 取 frontmatter 列表", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.deepEqual(n.tags, ["增长", "平台"]);
});

test("parseKnowledgeNote: related 取 ## 关联 块的标题 + 理由(理由为空则 reason='')", () => {
  const n = parseKnowledgeNote("飞轮效应", FULL);
  assert.deepEqual(n.related, [
    { title: "网络效应", reason: "都讲平台正反馈" },
    { title: "好战略", reason: "" },
  ]);
});

test("parseKnowledgeNote: 无 ## 关联 块 → 退到 frontmatter related 标题(reason '')", () => {
  const noBody = `---
shiyue_type: knowledge_point
source_pdf: "[[书.pdf]]"
source_page: 1
source_text: "x"
tags: []
related:
  - "[[A]]"
---

# 标题

摘要

## 原文
> 原文`;
  const n = parseKnowledgeNote("标题", noBody);
  assert.deepEqual(n.related, [{ title: "A", reason: "" }]);
});

test("parseKnowledgeNote: 无 frontmatter source_page → 0;无 source_text 原文块 → 空串", () => {
  const sparse = `---
shiyue_type: knowledge_point
source_pdf: "[[书.pdf]]"
tags: []
related: []
---

# 标题

摘要`;
  const n = parseKnowledgeNote("标题", sparse);
  assert.equal(n.source_page, 0);
  assert.equal(n.source_text, "");
  assert.equal(n.summary.trim(), "摘要");
});

test("parseKnowledgeNote: 标题缺失时退到 basename", () => {
  const noTitle = `---
shiyue_type: knowledge_point
source_pdf: "[[书.pdf]]"
source_page: 1
tags: []
related: []
---

摘要`;
  const n = parseKnowledgeNote("文件名标题", noTitle);
  assert.equal(n.title, "文件名标题");
});

test("parseKnowledgeNote: 无 frontmatter(裸 md)→ 不抛,合理缺省", () => {
  const bare = `# 标题

正文`;
  const n = parseKnowledgeNote("标题", bare);
  assert.equal(n.title, "标题");
  assert.equal(n.source_page, 0);
  assert.deepEqual(n.tags, []);
  assert.deepEqual(n.related, []);
});
