import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchProgressMarkdown,
  selectionWorkingMarkdown,
  batchSuccessMarkdown,
  selectionSuccessMarkdown,
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

// ── finalizeExtractionActions:面板终态决策(判别联合,合法组合编码进类型)──────────────
// 已有 streaming reply → finalize-reply(终态化它);fail → 另追加 error(finalize-reply-and-error);
// 无 reply + fail(early fail)→ append-error;无 reply + cancelled(confirmCost 门前撤回)→ silent。
// 原「无 reply + success」防御 appendTerminalReply 路径不可达(success 必在 onConfirmed/onBegin 后)→ 消去为 silent。

test("finalizeExtractionActions:有 reply + success → finalize-reply(终态文案)", () => {
  const r: ExtractionResult = { cancelled: false, kind: "success", message: "✓ done" };
  const a = finalizeExtractionActions(true, r);
  assert.deepEqual(a, { kind: "finalize-reply", markdown: "✓ done" });
});

test("finalizeExtractionActions:有 reply + cancelled → finalize-reply(取消文案)", () => {
  const r: ExtractionResult = { cancelled: true, kind: "cancelled", message: "已取消" };
  const a = finalizeExtractionActions(true, r);
  assert.deepEqual(a, { kind: "finalize-reply", markdown: "已取消" });
});

test("finalizeExtractionActions:有 reply + fail → finalize-reply-and-error(保留末帧 + 追加 error)", () => {
  const r: ExtractionResult = { cancelled: false, kind: "fail", message: "✗ 失败" };
  const a = finalizeExtractionActions(true, r);
  assert.deepEqual(a, { kind: "finalize-reply-and-error", markdown: selectionWorkingMarkdown(), error: "✗ 失败" });
});

test("finalizeExtractionActions:无 reply + cancelled(confirmCost 门前撤回)→ silent", () => {
  const r: ExtractionResult = { cancelled: true, kind: "cancelled", message: "已取消" };
  const a = finalizeExtractionActions(false, r);
  assert.deepEqual(a, { kind: "silent" });
});

test("finalizeExtractionActions:无 reply + fail(early fail)→ append-error", () => {
  const r: ExtractionResult = { cancelled: false, kind: "fail", message: "✗ 无 API key" };
  const a = finalizeExtractionActions(false, r);
  assert.deepEqual(a, { kind: "append-error", error: "✗ 无 API key" });
});

test("finalizeExtractionActions:无 reply + success(不可达,防御)→ silent(原 appendTerminalReply 路径消去)", () => {
  const r: ExtractionResult = { cancelled: false, kind: "success", message: "✓ done" };
  const a = finalizeExtractionActions(false, r);
  assert.deepEqual(a, { kind: "silent" });
});
