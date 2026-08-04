# 聊天 Agent 面板 — round 2 brief(待 /grill-with-docs)

> **源**:4 工单(01-04)已实现 + 人工验过 + `/code-review`(fixed point `7e9b9c4`)。Standards 轴 9 smells 全认可;Spec 轴 4 项用户澄清(2 项文档修正、2 项新需求)。
> **日期**:2026-08-04。**目的**:grill 2 个 design seam + 定 prefactor/behavior 拆分 → 成 spec 增补 → `/to-tickets` → `/implement`。

## 一句话目标

把 code-review 的 9 个 Standards smells(重构清理)+ 2 个新 spec 需求(浮动按钮走消息协议、流式 agent-reply 跨上下文切换不中断)落成 spec 增补 + ticket 批次。**关键耦合**:Standards #2(打包 `StreamingReplyState` / 去重两个 finalize)重构的正是 Spec #4 改的代码 → 必须同 ticket。

## 用户澄清的 4 项 spec(原 review findings 的重新定性)

1. **user-action 时机**(文档修正):confirmCost 门先于 user-action——点「提炼全书要点」先弹预估模态,消息流无气泡,确认后才弹 user-action。代码已实现(`onConfirmed` 调 `appendUserAction`);spec §3 #2「每个按钮 → user-action + agent-reply」过时,需改。
2. **link/page-jump 错误留 Notice**(文档修正):这类点击不生成 user-action → 错误消息对不合适,留 `Notice`。撤销 spec §7 该行迁移。无代码改(代码已 Notice)。
3. **浮动按钮走消息协议**(新需求):浮动「精读选中」点击须在 AI 区生成 `user-action`,后续路径同「提炼选中要点」按钮(即 `runExtractSelection`)。现状浮动 → `workspace.extractSelection()`(命令路径 Notice),需改走面板消息流。
4. **流式不随上下文切换中断**(新需求):在飞 agent-reply 跨上下文切换**继续完成**(不 abort + 「已取消」);agent-reply 生成期间,其他按钮 + 聊天输入框自动变灰(不可选)。

## 9 个 Standards smells(全认可,待序列化)

1. **Duplicated Code** — `extraction-controller.ts` `ownCtrl`/`signal`/`loading` 三元组在 extractBatch/extractSelection 重复 → 提 `resolveRunCtx(handlers, label)`。
2. **Duplicated Code + Data Clump** — `ai-panel-view.ts` `finalizeStreamingSynthesis`/`finalizeStreamingExtraction` 近重复 + `synthAbort`/`synthReplyId`、`extractAbort`/`extractReplyId` 是 Data Clump → 打包 `StreamingReplyState`,共享一个 finalize。**与 Spec #4 耦合**(同段代码)。
3. **Middle Man** — `shiyue-workspace.ts` `synthesisNoteExists` 纯一行透传 → 直调 controller(或接受为 PanelActions seam 代价)。
4. **Mysterious Name** — `extraction-controller.ts` `settle` → 改名 `returnResultWithNotice`。
5. **Primitive Obsession** — `extraction-messages.ts` `ExtractionFinalizeActions` 三个可选 string + docstring 不变式 → 用 `ExtractionTerminal` 或 discriminated union 承载。
6. **Speculative Generality** — `extraction-messages.ts` `ExtractionTerminal`/`extractionTerminal()` 导出但仅内部用 → inline 或去 export。
7. **Feature Envy** — `ai-panel-view.ts` `saveSynthesis` 伸手 `AgentReplyEntry.markdown`/`saveTargets` + 重建链接标签 `汇总 - ${file.basename}`(line 441)→ 链接逻辑属 `resolveSynthesisPath` seam。
8. **Shotgun Surgery**(#7 后果)— 改综合笔记文件名格式要同步改 `synthesis-note.ts`(path)+ `ai-panel-view.ts`(link label)+ spec → 提 `synthesisLinkLabel(trigger)`。
9. **Divergent Change** — `ai-panel-view.ts`(688 net)职责过多;`AgentReplyEntry`(line 534-661)是渲染循环关注点 → 拆 `agent-reply-entry.ts`(对齐 `chat-message.ts`/`extraction-messages.ts` 已有拆分)。

## 待 grill 的 2 个 design seam(fresh /grill-with-docs 走决策树)

**Seam A — 浮动按钮 → 面板消息流的路由(Spec #3)**:浮动按钮在预览侧(`selection-capture.ts` 的 `onDeepExtract`),消息流在面板侧(`ai-panel-view.ts` 的 `runExtractSelection`)。预览侧浮动如何调面板消息驱动抽取?候选:(a) PanelActions 暴露 `onDeepExtract` 注册——面板注册 handler 路由到 runExtractSelection,浮动调它(控制反转);(b) 浮动调 workspace 方法,workspace 检测面板在场并路由;(c) 事件总线。

**Seam B — 流式跨上下文切换生命周期(Spec #4 + Standards #2)**:上下文切换时在飞 agent-reply 继续(不 abort)。但 button-row 仍按新上下文重渲?流式 flag 覆盖 context 门控(全 disabled)?输入框(已禁用)视觉再灰?在飞 synthesis 完成后 save affordance 落哪(replyId 绑定,已对)?关面板(onClose)仍 abort(面板销毁)?第二条 streaming 能否启动(controls disabled → 否)?

## prefactor/behavior 拆分(待 grill 确认)

- **Prefactor(无 blocker)**:Std #9(拆 AgentReplyEntry 文件)、Std #2(打包 StreamingReplyState)、Std #1(resolveRunCtx)、Std #5/#6(ExtractionFinalizeActions)——都触 #3/#4 改的文件,先做让后续行为改更净。
- **Behavior(被 prefactor 阻塞)**:Std #2+Spec #4(流式生命周期)、Spec #3(浮动→消息)、Std #7/#8(链接标签)。
- **Trivial**:Std #3(middle man)、Std #4(rename)、Spec #1/#2(文档修正)。

## 相关文档(新 session 先读)

- `docs/superpowers/specs/2026-08-03-chat-panel-redesign.md`——主 spec(§3 消息协议、§4 门控、§7 Notice 迁移表待修正)。
- `docs/adr/0006-synthesis-saved-as-graph-node.md`——综合笔记 schema。
- `.scratch/chat-agent/issues/01-04*.md`——已落 4 工单(含 #01 的 code-review 笺注)。
- `src/workspace/ai-panel-view.ts`、`selection-capture.ts`、`extraction-controller.ts`、`extraction-messages.ts`、`synthesis-controller.ts`、`shiyue-workspace.ts`——待改代码。
