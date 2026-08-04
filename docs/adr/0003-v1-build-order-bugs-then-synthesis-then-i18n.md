---
status: accepted
---

# v1 实现顺序:Bug 1+3+4 → 汇总核心 → i18n 最后

修复优先级与新增汇总的顺序定为:Bug 1+3(`isPreviewLeafValid` 改 `containerEl.isConnected` + logo toggle,同根因)→ Bug 4(选区浮按钮,与 `selection-capture.ts` 解耦)→ 汇总核心(R1:扩 PanelTracker 跟踪知识点笔记 + AI 面板上下文切换 + honest-sparse 降级,被动事件、零 monkey-patch)→ i18n(Plan D,最后)。

i18n 放最后的决定性理由:它重写所有 user-facing 字符串,而汇总会引入新字符串。汇总先建、i18n 最后 → 每个字符串只重写一次(先做 i18n 则汇总新串需二次重写)。Bug 1+3/4 先修使现有抽取成稳定基线,再在面板上建汇总;Bug 4 解耦于汇总,可先行。

取舍:i18n「放最后」有滑向「永不」的风险。明确——它是 A 序列的最后一步,非 v1 外。若实际推进时 i18n 被一再推后,需重审。
