import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchProgressMarkdown,
  selectionWorkingMarkdown,
  extractionTerminal,
  type ExtractionResult,
} from "./extraction-messages.ts";

// ── batchProgressMarkdown:复用 extract.progress key「{done}/{total} → {points} 点」──────

test("batchProgressMarkdown:格式含 done/total/points 三占位", () => {
  const md = batchProgressMarkdown(3, 12, 7);
  assert.match(md, /3/);
  assert.match(md, /12/);
  assert.match(md, /7/);
});

test("batchProgressMarkdown:初始 0/total,points=0", () => {
  const md = batchProgressMarkdown(0, 12, 0);
  assert.match(md, /0.*12/);   // "0/12"
});

// ── selectionWorkingMarkdown:复用 extract.selectionLabel「精读中」──────────────────────

test("selectionWorkingMarkdown:非空文案", () => {
  const md = selectionWorkingMarkdown();
  assert.ok(md.trim().length > 0);
});

// ── extractionTerminal:ExtractionResult → 面板终态动作 ────────────────────────────────

test("extractionTerminal:success → reply(markdown=result.message)", () => {
  const r: ExtractionResult = { cancelled: false, kind: "success", message: "✓ 抽取完成:5 个知识点" };
  const term = extractionTerminal(r);
  assert.equal(term.kind, "reply");
  if (term.kind === "reply") assert.equal(term.markdown, "✓ 抽取完成:5 个知识点");
});

test("extractionTerminal:cancelled → reply(markdown=已取消)", () => {
  const r: ExtractionResult = { cancelled: true, kind: "cancelled", message: "已取消" };
  const term = extractionTerminal(r);
  assert.equal(term.kind, "reply");
  if (term.kind === "reply") assert.equal(term.markdown, "已取消");
});

test("extractionTerminal:fail → error(message=result.message)", () => {
  const r: ExtractionResult = { cancelled: false, kind: "fail", message: "✗ LLM 未返回有效知识点" };
  const term = extractionTerminal(r);
  assert.equal(term.kind, "error");
  if (term.kind === "error") assert.equal(term.message, "✗ LLM 未返回有效知识点");
});
