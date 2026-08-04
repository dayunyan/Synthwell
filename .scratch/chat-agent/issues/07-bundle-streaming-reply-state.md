# 07 — 打包 `StreamingReplyState` + 去重两个 finalize(Duplicated Code + Data Clump,Standards #2)

**What to build:** `ai-panel-view.ts` 的 `synthAbort`/`synthReplyId` 与 `extractAbort`/`extractReplyId` 是 Data Clump(成对出现的 abort+replyId);`finalizeStreamingSynthesis` 与 `finalizeStreamingExtraction` 是近重复的 abort+finalize 守卫(仅 id/abort 对不同)。打包成单一 `StreamingReplyState` 值 + 共享一个 finalize,消重复。**行为中立**——本 ticket 只重构,finalize 仍在上下文切换 abort(行为改在 ticket 09 / spec §10.1)。

**Blocked by:** None — can start immediately(行为中立重构;但与 ticket 09 同代码段,先做让 09 更净)

**Status:** ready-for-agent

- [ ] 新 `StreamingReplyState` 值类型:`{ abort: AbortController; replyId: string }`(或带 kind 区分 synth/extract,若 finalize 需差异化)。`ai-panel-view.ts` 用单一 `streaming: StreamingReplyState | null`(或两个具名 slot `synthStreaming`/`extractStreaming` 各持该类型)替代 4 个散字段。
- [ ] 共享 `finalizeStreaming(state, { onAbort, onFinalize })`(或合并为单方法,按 state 内 kind 分支):abort + 终态化其 reply。去重 `finalizeStreamingSynthesis`/`finalizeStreamingExtraction` 的重复守卫。
- [ ] `saveTargets`(synth)/replyId 绑定逻辑保留(汇总回复→触发文件映射,不破)。
- [ ] 行为不变:上下文切换仍 abort + 「已取消」(本 ticket 不改行为,09 改)。
- [ ] 现有测试绿(200);tsc + esbuild clean。
- [ ] 手验:汇总 + 提取的流式 / 停止 / 上下文切换收尾行为与重构前一致(本 ticket 净重构,无行为差)。
