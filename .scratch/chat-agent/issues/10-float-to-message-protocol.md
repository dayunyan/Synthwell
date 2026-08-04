# 10 — 浮动按钮走消息协议(spec §4 修订 + Standards #3 middle-man 已定保留)

**What to build:** 浮动「精读选中」点击须在 AI 区生成 `user-action`(label 同「提炼选中要点」——同一操作两个触发入口),后续路径同「提炼选中要点」按钮(即 `runExtractSelection` 消息流)。路由用**控制反转**:`PanelActions.setDeepExtractHandler(fn | null)`——面板 onOpen 注册 `() => runExtractSelection()`、onClose 注销;`syncSelectionCapture` 用注册的 handler 作 `onDeepExtract`(无 handler 退命令路径 Notice,防御性;面板与浮动同生共死,handler 恒在)。

**Blocked by:** 06(`runExtractSelection` 在 `ai-panel-view.ts`,06 拆 `AgentReplyEntry` 后面板更薄,注册 handler 更净——非硬阻塞但序顺更佳)

**Status:** ready-for-human — 实现完成,手验项待验(2026-08-04)。

- [x] `PanelActions` 加 `setDeepExtractHandler(fn: (() => void) | null): void`;`ShiyueWorkspace` 实现持 `deepExtractHandler` slot,`syncSelectionCapture` 的 `onDeepExtract` 用 `this.deepExtractHandler ?? (() => this.extractSelection())`(无 handler 退命令路径 Notice,防御性)。→ **调用时读** slot(非闭包捕获):`onDeepExtract: () => { const h = this.deepExtractHandler; if (h) h(); else void this.extractSelection(); }`。注册/注销后无需重挂浮按钮;重开面板换新 handler 不落旧 panel 实例(闭包捕获会在 panel 重开后仍调旧实例 runExtractSelection → 写入已 detach DOM)。
- [x] `ai-panel-view.ts` onOpen 调 `actions.setDeepExtractHandler(() => { void this.runExtractSelection(); })`;onClose 调 `actions.setDeepExtractHandler(null)`。
- [x] 浮动点击 → 走面板消息流:user-action(label「提炼选中要点」,同按钮)+ streaming agent-reply + 终态/error,与点「提炼选中要点」按钮一致。→ handler = `() => runExtractSelection()`,与按钮排「提炼选中要点」按钮同一方法(user-action 用 `panel.btn.selection` label,无新 key)。
- [x] 浮动按钮在触发的提取进行中仍藏(`setExtracting` 现有机制,验证不破)。→ `extractSelection` 仍调 `setExtracting(true)` → `captureHandle.setExtracting(true)` → `FloatVisibility` 闸住浮按钮。无改,未破。
- [x] i18n:label 复用 `panel.btn.selection`(同操作,不新增 key)。→ `runExtractSelection` 已用此 key,无改。
- [x] 现有测试绿(200);tsc + esbuild clean。→ tsc 0 错;esbuild production clean;`node --test` 215/215 绿不回归(无新纯 seam——`setDeepExtractHandler` 是 Obsidian-API 胶水,同 #03 syncSelectionCapture 不单测)。
- [ ] 手验:PDF 选中 → 点浮动「精读选中」→ AI 区出 user-action 气泡「提炼选中要点」+ 流式 agent-reply → 终态;与点按钮排「提炼选中要点」行为一致;提取中浮动按钮藏。
