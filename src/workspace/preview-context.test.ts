// src/workspace/preview-context.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePreviewContext } from "./preview-context.ts";

// 纯函数靠运行时 cast 走 .parent/.children/.currentTab/.view.file;fake 用最小形状满足这些 cast。
// 先例:panel-context.test.ts 用 `{ extension } as any` 满足 ContextFile;此处同理构造 leaf/parent 链。
type FakeLeaf = { view?: { file?: any }; parent?: any };
type FakeTabs = { parent?: any; children?: any[]; currentTab?: number };
type FakeSplit = { children?: any[] };

const file = (extension: string, path = `x.${extension}`) => ({ extension, path } as any);
const leaf = (f?: any): FakeLeaf => ({ view: f ? { file: f } : {} });
const split = (...children: FakeTabs[]): FakeSplit => ({ children });

/** 构造完整有效链:aiLeaf → aiTabs → split[aiTabs, previewTabs] → previewTabs.children[currentTab]。
 *  aiTabs 自身的 children 对走链无关(只 split.children 要含 aiTabs 作 ref 比对)。 */
function validChain(previewLeaves: FakeLeaf[], currentTab = 0): FakeLeaf {
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  const previewTabs: FakeTabs = { children: previewLeaves, currentTab };
  aiTabs.parent = split(aiTabs, previewTabs);
  return aiLeaf;
}

// ---- (a) 正常派生 ----
test("(a) aiLeaf 走到 preview PDF leaf → {leaf, file, kind:pdf}", () => {
  const pdfLeaf = leaf(file("pdf", "book.pdf"));
  const ctx = derivePreviewContext(validChain([pdfLeaf]) as any, () => null);
  assert.equal(ctx?.kind, "pdf");
  assert.equal(ctx?.file?.path, "book.pdf");
  assert.equal(ctx?.leaf, pdfLeaf);
});

test("(a) preview leaf 空文件(刚建,view 无 file)→ leaf 存在,file null,kind none", () => {
  const emptyLeaf = leaf();  // 无 file
  const ctx = derivePreviewContext(validChain([emptyLeaf]) as any, () => null);
  assert.equal(ctx?.leaf, emptyLeaf);
  assert.equal(ctx?.file, null);
  assert.equal(ctx?.kind, "none");
});

// ---- (b) aiLeaf null ----
test("(b) aiLeaf null → null", () => {
  assert.equal(derivePreviewContext(null as any, () => null), null);
});

// ---- (c) 右栏 split 无非-ai 子 ----
test("(c) split 只含 aiTabs(无 preview 兄弟)→ null", () => {
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  aiTabs.parent = split(aiTabs);  // 只 aiTabs
  assert.equal(derivePreviewContext(aiLeaf as any, () => null), null);
});

// ---- (d) kind 检测(复用 classifyContext,ADR-Bug4 一致)----
test("(d) md + shiyue_type=knowledge_point → knowledge-point", () => {
  const ctx = derivePreviewContext(validChain([leaf(file("md", "kp.md"))]) as any, () => ({ shiyue_type: "knowledge_point" }));
  assert.equal(ctx?.kind, "knowledge-point");
  assert.equal(ctx?.file?.path, "kp.md");
});

test("(d) md + 遗留 synthwell_type=knowledge_point → knowledge-point(Bug4 回归)", () => {
  const ctx = derivePreviewContext(validChain([leaf(file("md", "legacy.md"))]) as any, () => ({ synthwell_type: "knowledge_point" }));
  assert.equal(ctx?.kind, "knowledge-point");
});

test("(d) md + shiyue_type=synthesis → synthesis(#03 综合笔记透传)", () => {
  const ctx = derivePreviewContext(validChain([leaf(file("md", "synth.md"))]) as any, () => ({ shiyue_type: "synthesis" }));
  assert.equal(ctx?.kind, "synthesis");
});

test("(d) 普通 md(无知识点标识)→ none", () => {
  const ctx = derivePreviewContext(validChain([leaf(file("md", "plain.md"))]) as any, () => ({}));
  assert.equal(ctx?.kind, "none");
});

test("(d) PDF 无视 frontmatter → pdf", () => {
  const ctx = derivePreviewContext(validChain([leaf(file("pdf", "p.pdf"))]) as any, () => ({ shiyue_type: "knowledge_point" }));
  assert.equal(ctx?.kind, "pdf");
});

// ---- (e) 退化返 null(每步防御)----
test("(e) aiLeaf 无 parent → null", () => {
  assert.equal(derivePreviewContext(leaf(file("pdf")) as any, () => null), null);
});

test("(e) aiTabs 无 parent(split 缺)→ null", () => {
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };  // 无 parent
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  assert.equal(derivePreviewContext(aiLeaf as any, () => null), null);
});

test("(e) split.children 非数组 → null", () => {
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  (aiTabs as any).parent = { children: "nope" };
  assert.equal(derivePreviewContext(aiLeaf as any, () => null), null);
});

test("(e) preview tab 组 children 空 → null", () => {
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  const previewTabs: FakeTabs = { children: [], currentTab: 0 };
  aiTabs.parent = split(aiTabs, previewTabs);
  assert.equal(derivePreviewContext(aiLeaf as any, () => null), null);
});

test("(e) preview tab 组 children 缺失 → null", () => {
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  const previewTabs = {};  // 无 children
  aiTabs.parent = split(aiTabs, previewTabs as any);
  assert.equal(derivePreviewContext(aiLeaf as any, () => null), null);
});

// ---- currentTab 选激活 leaf(多 tab 切换正确性)----
test("currentTab 指向非首 leaf:取激活的,非 children[0]", () => {
  const a = leaf(file("pdf", "a.pdf")), b = leaf(file("pdf", "b.pdf"));
  const ctx = derivePreviewContext(validChain([a, b], 1) as any, () => null);
  assert.equal(ctx?.leaf, b);
  assert.equal(ctx?.file?.path, "b.pdf");
});

test("currentTab 越界 → 退化取末 leaf(不造假,有 leaf 即用)", () => {
  const a = leaf(file("pdf", "a.pdf"));
  const ctx = derivePreviewContext(validChain([a], 5) as any, () => null);  // 5 越界
  assert.equal(ctx?.leaf, a);
});

test("currentTab 未设(undefined)→ 取末 leaf(新建 tab 即活跃的常见路径)", () => {
  const a = leaf(file("pdf", "a.pdf")), b = leaf(file("pdf", "b.pdf"));
  const aiTabs: FakeTabs = { children: [leaf(file("md", "ai.md"))] };
  const aiLeaf = leaf(file("md", "ai.md")); aiLeaf.parent = aiTabs;
  const previewTabs: FakeTabs = { children: [a, b] };  // 无 currentTab
  aiTabs.parent = split(aiTabs, previewTabs);
  const ctx = derivePreviewContext(aiLeaf as any, () => null);
  assert.equal(ctx?.leaf, b);
});
