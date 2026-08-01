# 05 — 汇总 wiring: AI 面板上下文切换 + 渲染 + 取消 + 溯源(人工验)

**What to build:** 把 Synthesizer 接进 AI 面板,让汇总可触达——打开知识点笔记时面板从「抽取按钮」切到「汇总按钮」,点按钮跑 Synthesizer、流式渲染综合摘要、`[[笔记]](pN)` 可点跳转、可取消。触达走 R1(被动 `active-leaf-change`/`file-open` 观察,零 monkey-patch;R2 汇总时图谱保持可见延后)。PanelTracker 扩展为跟踪当前激活 leaf 的文件 + 其是否知识点笔记(读 `shiyue_type` frontmatter)。渲染用 `MarkdownRenderer.render()` + Component 生命周期管理(替换/取消时 unload 旧 Component,防泄漏,spec D6)。取消用 `AbortController` 贯穿(复用 LoadingNotice 或面板内 spinner,与抽取一致)。

**Blocked by:** 04 — Synthesizer 纯逻辑核心(本 ticket 调它)。

**Status:** ready-for-human

- [ ] PanelTracker 扩展:跟踪当前激活 leaf 的文件,暴露 `{file, isKnowledgePoint}`(读 `shiyue_type`);`active-leaf-change` 驱动切换。
- [ ] AI 面板上下文切换:当前是知识点笔记 → 显「汇总这个知识点」按钮;PDF 预览 → 显两抽取按钮(现状);普通 md/无文件 → 禁用。
- [ ] 点「汇总」→ 组 SynthesisInput(当前知识点 + 从 `拾阅笔记/知识点/` 扫关联笔记)→ `Synthesizer.synthesize` → 流式渲染结果。
- [ ] `[[笔记]](pN)` 渲成可点链接 → `workspace.openLinkText` 打开该笔记(原生,不跳页——跳页延后)。
- [ ] `MarkdownRenderer.render()` + Component 生命周期:替换/取消 unload 旧 Component。
- [ ] 取消:AbortController 贯穿 + loading(spinner/LoadingNotice);取消后已流式部分保留。
- [ ] 无 API key → 汇总按钮禁用 + 引导(与抽取一致)。
- [ ] `npm run build` clean;测试不回归(obsidian 耦合,人工验)。
- [ ] 人工验:开知识点笔记→面板切汇总;回 PDF→切回抽取;汇总流式+引用可点;取消保留;风格与 Obsidian 一致;切换稳定不抖。
