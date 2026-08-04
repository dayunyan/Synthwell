# 08 — 提取层重构簇:`resolveRunCtx` + `settle` 改名 + `ExtractionFinalizeActions`→`ExtractionTerminal`(Standards #1/#4/#5/#6)

**What to build:** `extraction-controller.ts` 与 `extraction-messages.ts` 的 4 个 Standards smells 一簇清理:`extractBatch`/`extractSelection` 重复的 `ownCtrl`/`signal`/`loading` 三元组提 `resolveRunCtx`;`settle` 改名 `returnResultWithNotice`;`ExtractionFinalizeActions`(三可选 string + docstring 不变式,Primitive Obsession)改用 `ExtractionTerminal` 承载;`ExtractionTerminal`/`extractionTerminal()` 去导出(仅内部用,Speculative Generality)。

**Blocked by:** None — can start immediately(行为中立重构)

**Status:** ready-for-human

- [x] `resolveRunCtx(handlers, label) -> { signal, loading? }`:消 `extraction-controller.ts` `extractBatch`/`extractSelection` 里 `ownCtrl`/`signal`/`loading` 三元组重复。
- [x] `settle(handlers, result, noticeMs)` → `returnResultWithNotice`(Mysterious Name:返 result;命令路径再 Notice)。
- [x] `ExtractionFinalizeActions`(三可选 `setReplyMarkdown`/`appendTerminalReply`/`appendError` + docstring 不变式)→ 用 discriminated union 承载(`finalize-reply`/`finalize-reply-and-error`/`append-error`/`silent`);`appendTerminalReply`-only 不可达路径消去为 `silent`。
- [x] `ExtractionTerminal`/`extractionTerminal()` 去导出(仅 `finalizeExtractionActions` 内部用)。
- [x] `ai-panel-view.ts` `finalizeExtractionReply` 适配判别联合(switch on `kind`)+ 抽 `finalizeExistingReply` helper 消两 arm 重复;行为不变。
- [x] 现有测试绿(211;tsc + esbuild clean;`extraction-messages.test.ts` 87 行,200 基线内)。
- [ ] 手验:面板内抽整篇 / 抽选区的进度流式 + 成功/取消/error 终态与重构前一致。
