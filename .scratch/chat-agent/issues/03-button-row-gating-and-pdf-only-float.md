# 03 — 按钮排门控 + 选区状态 + 浮动按钮 PDF-only 修复

**What to build:** 按钮排按上下文 kind 门控:synthesis kind 时无操作按钮 + 信息提示「综合笔记 — 汇总自 N 个知识点」(N = `synthesized_from` 长度);其余沿用既定门控。新增 `PanelContextKind = "synthesis"`(md + `shiyue_type === "synthesis"` → synthesis,经 `classifyContext` 自动透传 `derivePreviewContext`)。pdf 上下文的「提炼选中要点」按钮**无选区时 disabled(灰)**(点击不弹 error,反馈细化 #1)—— 需新增 `PanelActions.onSelectionChange` 订阅(与 `onContextChange` 并行,反映 `SelectionCache` 状态),按钮 disabled 态随选区有无切换。浮动「精读选中」按钮(`attachSelectionCapture`)**仅在 PDF 上下文挂载**,笔记/md 上下文不挂(**修复**——现状笔记上下文也出浮动按钮,点击失败 `notice.noPdf`,潜在的 #2 类脆性)。

**Blocked by:** 02(按钮排在 slice 02 重构的 `buttonRowEl` 上挂门控逻辑)

**Status:** ready-for-human

- [x] `panel-context.ts`:`PanelContextKind` 加 `"synthesis"`;`classifyContext` 认 `shiyue_type === "synthesis"`(优先于 knowledge-point 判定);`ContextFrontmatter` 加 `synthesized_from`。`panel-context.test.ts` 加 synthesis kind 测(+ `synthesisSourceCount` 纯辅助)。
- [x] `PanelActions` 加 `onSelectionChange(fn: (has: boolean) => void): () => void`;`ShiyueWorkspace` 实现(订阅 `SelectionCache` 变化 → 回调 has-selection)。`ai-panel-view.ts` 订阅 → 切「提炼选中要点」按钮 disabled 态。
- [x] `renderContext` switch 4 态:pdf(两提取按钮,selection 无选区 disabled)/ knowledge-point(汇总按钮)/ synthesis(无按钮 + 信息提示「综合笔记 — 汇总自 N 个知识点」,N 读 synthesis 笔记 frontmatter `synthesized_from` 长度)/ none(禁用占位)。
- [x] 「提炼选中要点」无选区时 disabled(灰,不弹 error);有选区时 enabled。提取进行中整排 disabled(复用 `setExtracting` 开关,验证 `attachSelectionCapture` 现有机制)。
- [x] 浮动「精读选中」按钮 PDF-only:`syncSelectionCapture`(原 `attachPreviewCapture` 改名)在 `PreviewContext.getKind() !== "pdf"` 时不挂 + 摘旧。kind 变化经 `previewCtx.onChange → syncSelectionCapture` 自动摘/挂。
- [x] i18n key(zh-CN+en):`panel.hint.synthesis`(含 {n} 模板);按钮 disabled 态视觉样式驱动(无需文案)。
- [x] 现有测试绿(188 → 200,新增 12)。
- [ ] 手验:开 PDF → 两按钮(无选区 selection 灰,有选区亮)+ 浮动按钮出现;开 KP → 汇总按钮,无浮动按钮;开综合笔记 → 无按钮 + 「汇总自 N 个知识点」提示;开普通 md → 禁用占位,无浮动按钮。切 PDF→笔记→PDF 浮动按钮正确挂/摘。
