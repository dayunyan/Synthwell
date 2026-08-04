import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldStickToBottom, newMessageId } from "./chat-message.ts";

// ── shouldStickToBottom:scroll 距底 ≤ threshold → 真(应自动滚到底)──────────

test("shouldStickToBottom:恰在底 → 真", () => {
  // scrollHeight 100, clientHeight 80 → scrollTop 上限 20;在底 scrollTop=20。
  assert.equal(shouldStickToBottom(20, 80, 100, 24), true);
});

test("shouldStickToBottom:距底在 threshold 内 → 真(用户上滚一点点不脱钩)", () => {
  // 距底 = scrollHeight - scrollTop - clientHeight = 100 - 16 - 80 = 4 ≤ 24。
  assert.equal(shouldStickToBottom(16, 80, 100, 24), true);
});

test("shouldStickToBottom:距底超过 threshold → 假(用户上滚,暂停自动滚)", () => {
  // 距底 = 100 - 10 - 80 = 10,仍 ≤ 24 → 真;再往上 scrollTop=0 → 距底 20 ≤ 24 → 真。
  // 用更大容器显假:scrollHeight 200, clientHeight 80, scrollTop 50 → 距底 70 > 24。
  assert.equal(shouldStickToBottom(50, 80, 200, 24), false);
});

test("shouldStickToBottom:threshold=0 → 仅恰在底为真", () => {
  assert.equal(shouldStickToBottom(20, 80, 100, 0), true);
  assert.equal(shouldStickToBottom(19, 80, 100, 0), false);
});

test("shouldStickToBottom:容器无溢出(scrollHeight ≤ clientHeight)→ 真", () => {
  // 内容不超容器:恒在底,自动滚无副作用。
  assert.equal(shouldStickToBottom(0, 100, 80, 24), true);
  assert.equal(shouldStickToBottom(0, 100, 100, 24), true);
});

// ── newMessageId:单调递增、唯一 ───────────────────────────────────────────

test("newMessageId:连续调用递增且唯一", () => {
  const a = newMessageId();
  const b = newMessageId();
  const c = newMessageId();
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
  assert.ok(a.length > 0);
});
