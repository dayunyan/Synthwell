// src/workspace/button-gating.ts — 按钮排 disabled 态纯决策(spec §10.1 / #09)。
// 纯逻辑、不 import obsidian(node:test 可加载单测)。view 的 syncButtons 据此决策驱动 DOM。
//
// #09:在飞流式回复(streaming)期间整排 disabled,跨上下文切换持续(不随 abort 清——
// renderContext 不再 finalizeStreaming,在飞回复继续完成)。回复完成 → streaming 清 → 整排恢复
// enabled(按新上下文 + selection 态)。extracting(深抽进行中,workspace setExtracting 同源信号——
// 命令/浮动路径 extraction 亦触发,此时面板未起 streaming 但仍应禁用整排)与 streaming 任一为真 →
// 整排 disabled。selection 按钮额外需 hasSelection(非 busy 时)。

/** 按钮排门控状态(view 持的三个布尔:streaming slot 是否在飞 / extracting 信号 / 选区有无)。 */
export interface ButtonGatingState {
  /** 在飞流式回复(#09:streaming slot !== null)。跨上下文切换持续,完成才清。 */
  streaming: boolean;
  /** 深抽进行中(workspace setExtracting;命令/浮动路径 extraction 亦触发)。 */
  extracting: boolean;
  /** 当前是否有选区(驱动 selection 按钮 enabled)。 */
  hasSelection: boolean;
}

/** 单按钮 disabled 决策(纯函数):整排 busy(streaming OR extracting)→ 全 disabled;
 *  selection 按钮非 busy 时还需 hasSelection。isSelection=false → 仅随整排 busy。
 *  view 的 syncButtons 对每个按钮调此(传 btn === selBtn)。 */
export function buttonDisabled(s: ButtonGatingState, isSelection: boolean): boolean {
  return s.streaming || s.extracting || (isSelection && !s.hasSelection);
}
