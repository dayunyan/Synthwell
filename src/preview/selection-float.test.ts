import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFloatPosition, FloatVisibility } from "./selection-float.ts";
import type { Rect } from "./selection-float.ts";

const rect = (l: number, t: number, w: number, h: number): Rect =>
  ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });

test("computeFloatPosition: 中部选区,上方有空间 → 置上方", () => {
  // 选区 top=300, btnH=30, gap=6 → aboveTop=264
  const p = computeFloatPosition(rect(100, 300, 50, 20), 80, 30, 1200, 800);
  assert.equal(p.top, 264);
  assert.equal(p.left, 100);
});

test("computeFloatPosition: 选区贴顶(上方不足)且下方够 → 置下方", () => {
  // top=10,bottom=30, btnH=30, gap=6 → aboveTop=-26<0; belowTop=36, fits 36+30=66<=800 → 下方
  const p = computeFloatPosition(rect(100, 10, 50, 20), 80, 30, 1200, 800);
  assert.equal(p.top, 36);
  assert.equal(p.left, 100);
});

test("computeFloatPosition: 上下都不够 → 贴选区顶部(不超 viewport)", () => {
  // top=5,bottom=15, viewportH=40, btnH=30, gap=6 → aboveTop=-31<0; belowTop=21, fits 51<=40? 否 → max(0,5)=5
  const p = computeFloatPosition(rect(100, 5, 50, 10), 80, 30, 1200, 40);
  assert.equal(p.top, 5);
});

test("computeFloatPosition: left 对齐选区,左溢出 → 钳到 0", () => {
  const p = computeFloatPosition(rect(-20, 300, 50, 20), 80, 30, 1200, 800);
  assert.equal(p.left, 0);
});

test("computeFloatPosition: left 右溢出 → 钳到 viewportW - btnW", () => {
  // selRect.left=795, btnW=80, vw=800 → min(795,720)=720 → max(0,720)=720
  const p = computeFloatPosition(rect(795, 300, 50, 20), 80, 30, 800, 800);
  assert.equal(p.left, 720);
});

test("FloatVisibility: 初始不可见(无选区)", () => {
  assert.equal(new FloatVisibility().visible(), false);
});

test("FloatVisibility: set 选区 → 可见", () => {
  const v = new FloatVisibility();
  v.setSelection({ text: "x", page: 1 });
  assert.equal(v.visible(), true);
});

test("FloatVisibility: 深抽中 → 不可见(不重复触发)", () => {
  const v = new FloatVisibility();
  v.setSelection({ text: "x", page: 1 });
  v.setExtracting(true);
  assert.equal(v.visible(), false);
  v.setExtracting(false);
  assert.equal(v.visible(), true);
});

test("FloatVisibility: 选区清空 → 不可见", () => {
  const v = new FloatVisibility();
  v.setSelection({ text: "x", page: 1 });
  v.setSelection(null);
  assert.equal(v.visible(), false);
});
