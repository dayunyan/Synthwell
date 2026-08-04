import { test } from "node:test";
import assert from "node:assert/strict";
import { SelectionCache, type SelInfo } from "./selection-cache.ts";

test("SelectionCache: 初始 get 为 null", () => {
  assert.equal(new SelectionCache().get(), null);
});

test("SelectionCache: set 后 get 返回该值", () => {
  const c = new SelectionCache();
  c.set({ text: "hi", page: 3 });
  assert.deepEqual(c.get(), { text: "hi", page: 3 });
});

test("SelectionCache: 多次 set 返回最新", () => {
  const c = new SelectionCache();
  c.set({ text: "a", page: 1 }); c.set({ text: "b", page: 2 });
  assert.equal(c.get()?.text, "b");
});

test("SelectionCache: clear 后 get 为 null", () => {
  const c = new SelectionCache();
  c.set({ text: "a", page: 1 }); c.clear();
  assert.equal(c.get(), null);
});

// ---- onChange 通知(#03:面板「提炼选中要点」按钮 disabled 态随选区有无切换)----
test("SelectionCache: onChange 注册时立即回调当前值(null)", () => {
  const c = new SelectionCache();
  let fired: SelInfo | null | "init" = "init";
  c.onChange((sel) => { fired = sel; });
  assert.equal(fired, null);
});

test("SelectionCache: set 后 onChange 回调该值;clear 后回调 null", () => {
  const c = new SelectionCache();
  const seen: (SelInfo | null)[] = [];
  c.onChange((sel) => seen.push(sel));
  c.set({ text: "a", page: 1 });
  c.clear();
  assert.deepEqual(seen, [null, { text: "a", page: 1 }, null]);
});

test("SelectionCache: 返回取消订阅函数,取消后不再回调", () => {
  const c = new SelectionCache();
  const seen: (SelInfo | null)[] = [];
  const off = c.onChange((sel) => seen.push(sel));
  off();
  c.set({ text: "a", page: 1 });
  assert.deepEqual(seen, [null]);  // 仅初始回调,取消后 set 不再触发
});

test("SelectionCache: 多监听器各自独立回调", () => {
  const c = new SelectionCache();
  let a = 0, b = 0;
  c.onChange(() => { a++; });
  c.onChange(() => { b++; });
  c.set({ text: "x", page: 1 });
  assert.equal(a, 2);  // 初始 + set
  assert.equal(b, 2);
});
