# 08 — 提取层重构簇:`resolveRunCtx` + `settle` 改名 + `ExtractionFinalizeActions`→`ExtractionTerminal`(Standards #1/#4/#5/#6)

**What to build:** `extraction-controller.ts` 与 `extraction-messages.ts` 的 4 个 Standards smells 一簇清理:`extractBatch`/`extractSelection` 重复的 `ownCtrl`/`signal`/`loading` 三元组提 `resolveRunCtx`;`settle` 改名 `returnResultWithNotice`;`ExtractionFinalizeActions`(三可选 string + docstring 不变式,Primitive Obsession)改用 `ExtractionTerminal` 承载;`ExtractionTerminal`/`extractionTerminal()` 去导出(仅内部用,Speculative Generality)。

**Blocked by:** None — can start immediately(行为中立重构)

**Status:** ready-for-agent

- [ ] `resolveRunCtx(handlers, label) -> { signal, loading? }`:消 `extraction-controller.ts` `extractBatch`/`extractSelection` 里 `ownCtrl`/`signal`/`loading` 三元组重复。
- [ ] `settle(handlers, result, noticeMs)` → `returnResultWithNotice`(Mysterious Name:返 result;命令路径再 Notice)。
- [ ] `ExtractionFinalizeActions`(三可选 `setReplyMarkdown`/`appendTerminalReply`/`appendError` + docstring 不变式)→ 用 `ExtractionTerminal`(已定义)或 discriminated union 承载;`appendTerminalReply`-only 不可达路径消去。
- [ ] `ExtractionTerminal`/`extractionTerminal()` 去导出(仅 `finalizeExtractionActions` 内部用)或 inline。
- [ ] `ai-panel-view.ts` `finalizeExtractionReply` 适配新承载类型(行为不变)。
- [ ] 现有测试绿(`extraction-messages.test.ts` 200 基线内);tsc + esbuild clean。
- [ ] 手验:面板内抽整篇 / 抽选区的进度流式 + 成功/取消/error 终态与重构前一致。
