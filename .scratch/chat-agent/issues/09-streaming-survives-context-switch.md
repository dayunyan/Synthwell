# 09 — 流式 agent-reply 跨上下文切换不中断(spec §10.1 + Standards #2 行为)

**What to build:** 在飞 agent-reply(汇总 / 提取)跨上下文切换**继续完成**,不 abort + 「已取消」。abort 仅在面板关闭(`onClose`)发生。上下文切换时 `buttonRowEl` 仍按新上下文重渲(context-gating 不变),但 **streaming flag 覆盖 → 整排 disabled**;在飞回复按 replyId 绑定其原触发文件,完成后 save affordance 落该回复。

**Blocked by:** 07(`StreamingReplyState` 打包——本 ticket 改的就是 finalize 的 abort 时机,先打包让改更净)

**Status:** ready-for-agent

- [ ] `renderContext` 不再调 `finalizeStreaming*` 的 abort 分支(上下文切换不收尾在飞回复)。
- [ ] abort 收尾移到 `onClose`(面板销毁——reply 的 Component 必须清,防泄漏 D6)。
- [ ] streaming flag 持续覆盖 `syncButtons` 整排 disabled,跨上下文切换不随 abort 清(07 打包后用 `StreamingReplyState` 表达「在飞」)。
- [ ] 在飞回复完成后 save affordance 落该回复(replyId 绑定原文件,`saveTargets` 已对;synthesis 路径)。
- [ ] 验证:上下文切换时 buttonRowEl 重渲为新上下文按钮但全 disabled;回复继续增长;完成后整排恢复 enabled(按新上下文 + selection 态)。
- [ ] 边界:面板关闭 → 仍 abort + 清 Component(防泄漏);第二条 streaming 无法启动(整排 disabled 拦)。
- [ ] 输入框:已永久禁用,不加 cosmetic busy 态(已灰,二次灰噪声)——明确不做事。
- [ ] 现有测试绿(200,新增 streaming-survives-switch 测);tsc + esbuild clean。
- [ ] 手验:开 KP → 点汇总(流式中)→ 切到 PDF 上下文 → 按钮排显 PDF 按钮但全灰,汇总回复继续增长到完成 → 显 save affordance(原 KP 文件)→ 整排恢复;关面板 → 在飞回复清(不泄漏)。
