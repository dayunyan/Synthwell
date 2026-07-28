// src/workspace/preview-tracker.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewTracker } from "./preview-tracker.ts";

test("PreviewTracker: 初始 get 为 null", () => {
  assert.equal(new PreviewTracker().get(), null);
});

test("PreviewTracker: set 后 get 返回该文件对象", () => {
  const t = new PreviewTracker();
  const f = { path: "x.pdf" } as any;
  t.set(f);
  assert.equal(t.get(), f);
});

test("PreviewTracker: onChange 注册时立即回调当前值", () => {
  const t = new PreviewTracker();
  t.set({ path: "a" } as any);
  let seen: any = "init";
  t.onChange((f) => { seen = f; });
  assert.equal(seen?.path, "a");
});

test("PreviewTracker: set 触发所有 listener", () => {
  const t = new PreviewTracker();
  const seen: any[] = [];
  t.onChange((f) => seen.push(f));
  t.set({ path: "b" } as any);
  assert.equal(seen.at(-1)?.path, "b");
});

test("PreviewTracker: onChange 返回的取消订阅生效", () => {
  const t = new PreviewTracker();
  const seen: any[] = [];
  const off = t.onChange((f) => seen.push(f));
  off();
  t.set({ path: "c" } as any);
  // 取消后不应再推(初始那次 onChange 已 push 过 null,这里只看 set 不再推)
  assert.equal(seen.find((f) => f && f.path === "c"), undefined);
});
