import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchProgressMarkdown,
  selectionWorkingMarkdown,
  batchSuccessMarkdown,
  selectionSuccessMarkdown,
  extractionTerminal,
  finalizeExtractionActions,
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

// ── selectionWorkingMarkdown:#04 气泡进行中文本(精读中…)──────────────────────────────

test("selectionWorkingMarkdown:非空文案", () => {
  const md = selectionWorkingMarkdown();
  assert.ok(md.trim().length > 0);
});

// ── batchSuccessMarkdown / selectionSuccessMarkdown:#04 气泡终态(区别 Notice 文案)─────

test("batchSuccessMarkdown:含 count 与 notesPath 占位", () => {
  const md = batchSuccessMarkdown(5, "拾阅笔记/知识点");
  assert.match(md, /5/);
  assert.match(md, /拾阅笔记\/知识点/);
});

test("selectionSuccessMarkdown:含 title", () => {
  const md = selectionSuccessMarkdown("飞轮效应");
  assert.match(md, /飞轮效应/);
});

// ── finalizeExtractionActions:面板终态决策(纯,无 DOM)──────────────────────────────
// 已有 streaming reply → setReplyMarkdown(终态化它);无 reply 且 reply 类终态 → appendTerminalReply;
// fail → appendError。三者可组合(setReplyMarkdown + appendError 同时)。

test("finalizeExtractionActions:有 reply + success → 仅 setReplyMarkdown=成功文案", () => {
  const r: ExtractionResult = { cancelled: false, kind: "success", message: "✓ done" };
  const a = finalizeExtractionActions(true, r);
  assert.equal(a.setReplyMarkdown, "✓ done");
  assert.equal(a.appendTerminalReply, undefined);
  assert.equal(a.appendError, undefined);
});

test("finalizeExtractionActions:有 reply + cancelled → setReplyMarkdown=取消文案", () => {
  const r: ExtractionResult = { cancelled: true, kind: "cancelled", message: "已取消" };
  const a = finalizeExtractionActions(true, r);
  assert.equal(a.setReplyMarkdown, "已取消");
  assert.equal(a.appendTerminalReply, undefined);
  assert.equal(a.appendError, undefined);
});

test("finalizeExtractionActions:有 reply + fail → setReplyMarkdown=进行中文本(保留末帧)+ appendError", () => {
  const r: ExtractionResult = { cancelled: false, kind: "fail", message: "✗ 失败" };
  const a = finalizeExtractionActions(true, r);
  assert.equal(a.setReplyMarkdown, selectionWorkingMarkdown());   // fail 保留末帧(进行中文本)
  assert.equal(a.appendError, "✗ 失败");
  assert.equal(a.appendTerminalReply, undefined);
});

test("finalizeExtractionActions:无 reply + cancelled(confirmCost 门前取消)→ appendTerminalReply=取消", () => {
  const r: ExtractionResult = { cancelled: true, kind: "cancelled", message: "已取消" };
  const a = finalizeExtractionActions(false, r);
  assert.equal(a.appendTerminalReply, "已取消");
  assert.equal(a.setReplyMarkdown, undefined);
  assert.equal(a.appendError, undefined);
});

test("finalizeExtractionActions:无 reply + fail(early fail)→ 仅 appendError", () => {
  const r: ExtractionResult = { cancelled: false, kind: "fail", message: "✗ 无 API key" };
  const a = finalizeExtractionActions(false, r);
  assert.equal(a.appendError, "✗ 无 API key");
  assert.equal(a.appendTerminalReply, undefined);
  assert.equal(a.setReplyMarkdown, undefined);
});

test("finalizeExtractionActions:无 reply + success(不应发生,防御)→ appendTerminalReply", () => {
  const r: ExtractionResult = { cancelled: false, kind: "success", message: "✓ done" };
  const a = finalizeExtractionActions(false, r);
  assert.equal(a.appendTerminalReply, "✓ done");
  assert.equal(a.appendError, undefined);
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
