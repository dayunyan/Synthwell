# 09 — 流式 agent-reply 跨上下文切换不中断(spec §10.1 + Standards #2 行为)

**What to build:** 在飞 agent-reply(汇总 / 提取)跨上下文切换**继续完成**,不 abort + 「已取消」。abort 仅在面板关闭(`onClose`)发生。上下文切换时 `buttonRowEl` 仍按新上下文重渲(context-gating 不变),但 **streaming flag 覆盖 → 整排 disabled**;在飞回复按 replyId 绑定其原触发文件,完成后 save affordance 落该回复。

**Blocked by:** 07(`StreamingReplyState` 打包——本 ticket 改的就是 finalize 的 abort 时机,先打包让改更净)

**Status:** ready-for-human(手验项待验)

- [x] `renderContext` 不再调 `finalizeStreaming*` 的 abort 分支(上下文切换不收尾在飞回复)。→ 删 `renderContext` 首行 `this.finalizeStreaming()`;在飞 slot 持续到 `run*` 终态(`endStreaming`)或 `onClose`。
- [x] abort 收尾移到 `onClose`(面板销毁——reply 的 Component 必须清,防泄漏 D6)。→ `onClose` 仍调 `finalizeStreaming()`(abort + onAbort + 清 slot)+ `unloadAllEntries()`(清 Component);issue 明定「abort 收尾移到 onClose」即此。
- [x] streaming flag 持续覆盖 `syncButtons` 整排 disabled,跨上下文切换不随 abort 清(07 打包后用 `StreamingReplyState` 表达「在飞」)。→ 新纯 seam `button-gating.ts`(`buttonDisabled({streaming,extracting,hasSelection}, isSelection)`);`syncButtons` 经此决策,`streaming: this.streaming !== null` 跨上下文切换持续(不随 abort 清,因 `renderContext` 不再清 slot)。`beginStreaming`/`endStreaming` 在 slot 转换时重渲按钮排(开始→整排灰,完成→恢复 enabled)。
- [x] 在飞回复完成后 save affordance 落该回复(replyId 绑定原文件,`saveTargets` 已对;synthesis 路径)。→ `saveTargets.set(replyId, file)` 于 `runSynthesis` 创建时;`saveSynthesis` 经 `saveTargets.get(replyId)` 取原文件(replyId-binding,防新汇总启动后旧回复存错文件)。#07 已对,#09 未改。
- [x] 验证:上下文切换时 buttonRowEl 重渲为新上下文按钮但全 disabled;回复继续增长;完成后整排恢复 enabled(按新上下文 + selection 态)。→ `button-gating.test.ts` 4 测覆盖 gating 契约(streaming→整排 disabled / 非 busy+selection→启用 / 非 busy+无选区→selection 灰 / extracting→整排 disabled);「回复继续增长」(no-abort 控制流)属视图行为,走手验(同 #07/#08 pattern:纯 seam 单测 + 视图手验)。
- [x] 边界:面板关闭 → 仍 abort + 清 Component(防泄漏);第二条 streaming 无法启动(整排 disabled 拦)。→ `onClose` finalizeStreaming abort + unloadAllEntries 清 Component;第二条 streaming:streaming 时整排 disabled(button-gating),按钮点击不触发 `run*`;`run*` 启动前 `finalizeStreaming` 兜底收尾旧在飞。
- [x] 输入框:已永久禁用,不加 cosmetic busy 态(已灰,二次灰噪声)——明确不做事。→ `inputEl` `onOpen` 设 `disabled=""`,#09 未加 streaming-driven 类。
- [x] 现有测试绿(200,新增 streaming-survives-switch 测);tsc + esbuild clean。→ 实测 215 绿(211 base + 4 button-gating);tsc + esbuild(`npm run build`)clean。
- [ ] 手验:开 KP → 点汇总(流式中)→ 切到 PDF 上下文 → 按钮排显 PDF 按钮但全灰,汇总回复继续增长到完成 → 显 save affordance(原 KP 文件)→ 整排恢复;关面板 → 在飞回复清(不泄漏)。

---

**落地**(2026-08-04,行为改 + Std #2 同段):两改动——① `renderContext` 删 `finalizeStreaming()` 调用(上下文切换不再 abort 在飞回复,slot 持续到 `run*` 终态或 `onClose`);② `syncButtons` 经新纯 seam `button-gating.ts`(`buttonDisabled({streaming,extracting,hasSelection}, isSelection)` = `streaming || extracting || (isSelection && !hasSelection)`),`streaming` 维度新增(原仅 `extracting` 经 selection 禁用,汇总/batch 流式期整排未灰——#09 补)。`beginStreaming(s)`/`endStreaming(replyId)` 包 slot 转换 + `syncButtons()`(开始→整排灰,完成→恢复 enabled;replyId-binding guard 防旧回调误清新在飞)。`runSynthesis`/`runExtract` 改用此对替直接赋值/清。`finalizeStreaming` 仅留 `onClose` + `run*` 启动前兜底两处(注释明示不再用于上下文切换)。新 `button-gating.test.ts` 4 测(node:test,纯决策)。净 +25 行(view +20 / seam +17 / test +33 / -删 abort 调用);215 测试绿(211+4);tsc + esbuild clean。**code-review**(working tree)Standards 无硬违(轻 Middle-Man `begin/endStreaming` justified by syncButtons 不变式 + 低 Speculative Generality `isSelection` 形诚实保留)/ Spec 行为 faithful(renderContext no-abort / streaming-covers-syncButtons / replyId-bound save / onClose abort / 单 streaming gate / 无 input cosmetic 全中),1 judgement:`onClose` `finalizeStreaming` 跑 `onAbort` 终态化 dying panel 上(setMarkdown 排异步渲染,gen-guarded 自废,安全但噪)——issue 明定「abort 收尾移到 onClose」即 `finalizeStreaming`,留此匹配 issue 意图。**待手验**:跨上下文切换流式不中断 + 完成后 save affordance 落原 KP + 关面板清。
