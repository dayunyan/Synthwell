# 聊天 Agent — 交接说明(brief,待 /grill-with-docs 成 spec)

> **目的**:给一个**全新 session** 的 `/grill-with-docs` 跑起步用。本文件是 brief,不是 spec——grill 后出 spec → /to-tickets → /implement。
> **日期**:2026-08-03。**源**:用户 #07 implement 后反馈的 6 项里,5 项(1/2/4/5/6)实为「聊天 Agent 面板重构」这一件大事;#3(源 PDF 解析)已单独修(commit f98e8fb)。

## 一句话目标

把拾阅 AI 面板(`shiyue-ai-panel` view)从「按上下文切按钮 + 单 synthesisEl」重构成**聊天式消息 UI**:底部聊天输入框 + 框下方一排按需按钮(「提炼选中要点」「汇总关联笔记」等);点按钮 = 发一条消息(展示在输入框上方消息区);LLM 调用 / 抽取 / 汇总结果以 **Agent 回复消息**形式展现(替代原 Notice);汇总结果作为回复消息,「存回笔记」按钮跟随该消息后(点 = 以消息形式发)。这**就是** ADR-0002 / CONTEXT 定义的「聊天 Agent」(延后功能,现建)。

## 覆盖的反馈项

- **#1**(save-to-note 时机):重构后 save 按钮跟随汇总消息后出现 → 自然解决。
- **#2**(点 [[笔记]] 后汇总消失):重构后汇总是一条**持久消息**;切上下文/导航不清消息区 → 解决。
- **#4**(save 逻辑:存为**新笔记**关联其他笔记,为图谱树状分层铺路):**design decision 已定**——save synthesis as a NEW note linking the related notes(非追加到当前笔记 `## 综合汇总`)。grill 细化 schema。
- **#5**(聊天式 UI):本 brief 主旨。
- **6**(UI style):重构时一并优化(Obsidian CSS 变量,随主题)。

## 架构就绪度(为 Agent 铺的地基,已落)

- **PreviewContext**(`src/workspace/preview-context.ts`):纯读侧,每次读从布局结构现派生 {leaf, file, kind};纯 seam `derivePreviewContext` 可单测。**Agent 读「当前上下文」走它**。
- **PreviewSplit**(`src/workspace/preview-split.ts`):写侧 adapter,小 interface(ensure/toggle/openInPreview)藏布局脆性。**Agent「开文件进预览区」走它**。
- **`PanelActions` interface**(`src/workspace/shiyue-workspace.ts`):Agent 的 **tool 表面**——getCurrentFile/getCurrentSelection/onContextChange/extractBatch/extractSelection/openInPreview/synthesize/openSourcePage。Agent(或按钮)调这些,不直接碰 Obsidian API。
- **core/ 纯逻辑**(`core/extraction/` BatchExtractor/SelectionExtractor/Synthesizer + `core/llm/`):已 tool 形状(注入 LLMProvider),单测覆盖。Agent 经 controller 调,不重写。
- **i18n**(`src/i18n/index.ts`):`t()` 路由所有 user-facing 串;新消息/按钮文案加 key(zh-CN+en,`satisfies` 编译期强制双译)。LLM prompt 不 i18n。

## 已定 design 决策

1. **ADR-0002**:聊天 Agent ≠ 汇总;后期 Agent 把「汇总」包成一个 tool。两者分立范畴。
2. **#4(本 brief)**:save synthesis → **新笔记**(关联提到的其他笔记,为图谱树状分层铺路),非追加 `## 综合汇总`。frontmatter 待 grill 定(`shiyue_type: synthesis`?或 knowledge_point + `extraction_mode: synthesis`?)。
3. **#5**:消息协议——按钮 = 发消息 + 调 tool;LLM 输出 = Agent 回复消息;汇总 = 回复消息 + save 按钮跟随。

## 待 grill 的开放问题(fresh /grill-with-docs 走决策树)

1. **真 NL→tool-calling Agent,还是「结构化聊天」壳?** ADR-0002 说 NL 驱动工具调用;但 #5 的「按钮即发消息」像是**混合**:按钮是快捷方式(发消息 + 直接调 tool,无 NL 解析),输入框留给未来真 NL。v1 是只做**壳 + 按钮即 tool**(NL 输入留位不实现),还是连真 NL Agent?**建议 v1 = 壳 + 按钮即 tool**(NL 留位,真 Agent 后续)——避免一次造两件事(壳 + NL 解析)。
2. **消息协议形状**:消息类型(user-action / agent-reply / progress / result / synthesis+action)?每条消息 MarkdownRenderer + Component 生命周期(D6,复用 #05 的 renderChain/renderGen 防泄漏模式)。
3. **tool 集**:哪些 PanelActions 函数成 tool?openInPreview/extractBatch/extractSelection/synthesize/saveSynthesisAsNote/openSourcePage。按钮按 PanelContext(kind=pdf→显提炼按钮;knowledge-point→显汇总按钮)。
4. **save-as-new-note schema**:新笔记放 `拾阅笔记/汇总/<源知识点>/`?frontmatter(`shiyue_type: synthesis` + `synthesized_from: [[源笔记]]` + `related: [[关联笔记]][]`)?body = 综合摘要 + `[[关联笔记]](pN)` 溯源?为图谱树状分层:`synthesized_from` + `related` backlink → 图谱自动分层(知识点→汇总节点)。
5. **UI**:聊天输入框(NL 留位,占位文案「聊天 Agent(待实现)」?或可输但 v1 不解析);消息区(滚动,每条消息卡片);按钮排(按上下文 kind 切换显隐,context-aware);style(Obsidian CSS 变量)。
6. **Notice → 消息迁移**:原 LoadingNotice(spinner+stop)→ 进度消息(可取消)?原 Notice 错误 → agent 错误消息?保留 Notice 用于非面板场景(命令面板触发)?

## 现状面板(待重构)

- `src/workspace/ai-panel-view.ts`:当前 actionsEl(按钮)+ synthesisEl(单汇总区)+ chat-placeholder。重构成 messagesEl(消息流)+ inputEl(输入框)+ buttonRowEl(按需按钮)。
- `src/workspace/synthesis-controller.ts` / `extraction-controller.ts`:逻辑留,面板改成消息驱动调它们。
- `styles.css`:.shiyue-ai-panel / .shiyue-ai-synthesis / .shiyue-ai-synth-save / .shiyue-page-jump 等 → 重构为消息卡片 + 输入框 + 按钮排样式。

## 相关文档(新 session 先读)

- `CONTEXT.md`——聊天 Agent / 汇总 / 抽取 / R1-R2 / honest-sparse 术语。
- `docs/adr/0002-rag-synthesis-is-v1-scope-separate-from-chat-agent.md`——Agent 与汇总分立。
- `docs/superpowers/specs/2026-07-27-phase1-ai-extraction-design.md` §6——汇总/溯源原设计。
- `.scratch/shiyue-v1/issues/05-synthesis-wiring-ai-panel-context-switch.md` + `07-spec-missing-save-to-note-and-page-jump.md`——当前面板 + #07(save-to-note/page-jump)上下文。
- `docs/superpowers/2026-07-28-shiyue-progress.md` + 记忆 `shiyue-workspace-progress.md`——全项目脉络。

## 起步动作(fresh session)

1. `/grill-with-docs` 读本 brief + CONTEXT + ADR-0002 → 走决策树(上面 6 个开放问题,逐个)。
2. 成 spec → `/to-tickets`(消息协议 / save-as-new-note / 面板重构 / style 各带 blocking edges)→ `/implement`(fresh per ticket)。
3. 不在长 session 里 implement(本 brief 源 session 已超长,degraded 风险)。
