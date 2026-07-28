import { test } from "node:test";
import assert from "node:assert/strict";
import { SelectionCache } from "./selection-cache.ts";

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
