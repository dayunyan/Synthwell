import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonDisabled, type ButtonGatingState } from "./button-gating.ts";

// #09 / spec §10.1:在飞流式回复(streaming)期间按钮排整排 disabled,跨上下文切换持续
// (renderContext 不再 abort 在飞回复),回复完成 → streaming 清 → 整排恢复 enabled。
// extracting(深抽进行中,workspace setExtracting 同源信号——命令/浮动路径 extraction 亦触发,
// 面板未起 streaming 但仍应禁用整排)与 streaming 任一为真 → 整排 disabled。
// selection 按钮额外需 hasSelection(非 busy 时)。

const S = (streaming: boolean, extracting: boolean, hasSelection: boolean): ButtonGatingState =>
  ({ streaming, extracting, hasSelection });

// ── streaming 覆盖整排(#09 核心:在飞回复期间全 disabled,跨上下文切换持续)──────────

test("buttonDisabled: streaming 时所有按钮 disabled(整排覆盖,跨上下文切换持续)", () => {
  // isSelection=false(普通按钮)+ true(selection 按钮)皆 disabled,与 extracting/hasSelection 无关。
  for (const sel of [false, true]) {
    assert.equal(buttonDisabled(S(true, false, true), sel), true);
    assert.equal(buttonDisabled(S(true, false, false), sel), true);
    assert.equal(buttonDisabled(S(true, true, true), sel), true);
  }
});

test("buttonDisabled: streaming=false + extracting=true → 整排 disabled(命令/浮动路径 extraction)", () => {
  // 面板未起 streaming,但 workspace setExtracting(命令/浮动触发)→ 仍禁用整排。
  for (const sel of [false, true]) {
    assert.equal(buttonDisabled(S(false, true, true), sel), true);
    assert.equal(buttonDisabled(S(false, true, false), sel), true);
  }
});

// ── 回复完成 → streaming 清 → 整排恢复 enabled(按新上下文 + selection 态)──────────

test("buttonDisabled: 非 busy + 有选区 → selection 按钮启用,普通按钮启用", () => {
  assert.equal(buttonDisabled(S(false, false, true), true), false);   // selection 启用
  assert.equal(buttonDisabled(S(false, false, true), false), false);  // 普通按钮启用
});

test("buttonDisabled: 非 busy + 无选区 → selection 按钮 disabled,普通按钮仍启用", () => {
  assert.equal(buttonDisabled(S(false, false, false), true), true);   // selection 需选区
  assert.equal(buttonDisabled(S(false, false, false), false), false); // 普通按钮不受 hasSelection 影响
});
