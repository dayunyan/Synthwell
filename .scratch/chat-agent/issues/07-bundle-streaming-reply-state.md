# 07 — 打包 `StreamingReplyState` + 去重两个 finalize(Duplicated Code + Data Clump,Standards #2)

**What to build:** `ai-panel-view.ts` 的 `synthAbort`/`synthReplyId` 与 `extractAbort`/`extractReplyId` 是 Data Clump(成对出现的 abort+replyId);`finalizeStreamingSynthesis` 与 `finalizeStreamingExtraction` 是近重复的 abort+finalize 守卫(仅 id/abort 对不同)。打包成单一 `StreamingReplyState` 值 + 共享一个 finalize,消重复。**行为中立**——本 ticket 只重构,finalize 仍在上下文切换 abort(行为改在 ticket 09 / spec §10.1)。

**Blocked by:** None — can start immediately(行为中立重构;但与 ticket 09 同代码段,先做让 09 更净)

**Status:** done — committed in `578c66b`+`00f61ac`(w0-spike). 净重构 -2 行;214 测试绿;tsc + esbuild clean. `/code-review`(fixed `HEAD`)Standards 无硬违 + Spec 全项满足(初版 `kind` switch 被 review 标为 Duplicated-Code 残留 → 改 `onAbort` 闭包消除). **手验通过**(2026-08-04,用户确认):汇总 + 提取的流式 / 停止 / 上下文切换收尾行为与重构前一致.

- [x] 新 `StreamingReplyState` 值类型:`{ abort: AbortController; replyId: string }`(或带 kind 区分 synth/extract,若 finalize 需差异化)。`ai-panel-view.ts` 用单一 `streaming: StreamingReplyState | null`(或两个具名 slot `synthStreaming`/`extractStreaming` 各持该类型)替代 4 个散字段。→ 单 slot + `onAbort` 闭包(`{ abort, replyId, onAbort }`),无 kind 字段——`onAbort` 承载 synth/extract 终态化差异。
- [x] 共享 `finalizeStreaming(state, { onAbort, onFinalize })`(或合并为单方法,按 state 内 kind 分支):abort + 终态化其 reply。去重 `finalizeStreamingSynthesis`/`finalizeStreamingExtraction` 的重复守卫。→ `finalizeStreaming()` 守卫 + abort + 调 `state.onAbort(replyId)` + 清 slot;两旧方法删。
- [x] `saveTargets`(synth)/replyId 绑定逻辑保留(汇总回复→触发文件映射,不破)。
- [x] 行为不变:上下文切换仍 abort + 「已取消」(本 ticket 不改行为,09 改)。→ code-review 四路径(合成/提取 × 正常完成/上下文切换)逐一比对,可观察结果等价;`run*` 终态清 slot 用 replyId-binding guard 防旧回调误清新在飞(strictly safer,spec §10.1 已预)。
- [x] 现有测试绿(200);tsc + esbuild clean。→ 实测 214 绿;tsc + esbuild(`npm run build`)clean。
- [x] 手验:汇总 + 提取的流式 / 停止 / 上下文切换收尾行为与重构前一致(本 ticket 净重构,无行为差)。→ 2026-08-04 用户确认通过。

---

**落地**(commit `578c66b`+`00f61ac`,2026-08-04):单 `streaming: StreamingReplyState | null` slot 替 4 散字段;`finalizeStreaming()` 共享守卫+abort+清(调 `onAbort` 终态化,无 kind 分支);`finalizeReply`/`finalizeExtractionReply` 改纯 entry 终态化(slot 清移到 `run*` 终态 + replyId-binding guard)。`/code-review`(fixed `HEAD`):Standards 无硬违(初版 `kind` switch 被 review 标为 Duplicated-Code 残留 → 改 `onAbort` 闭包消除,review 通过);Spec 全项满足。净 -2 行。**手验通过**(2026-08-04,用户确认)。
