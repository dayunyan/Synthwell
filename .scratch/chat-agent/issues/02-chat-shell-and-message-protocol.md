# 02 — 聊天壳子 + 消息协议(汇总迁移到消息)

**What to build:** 把 AI 面板从「按钮 + 单 synthesisEl + chat-placeholder」重构成 `messagesEl`(消息流)+ `buttonRowEl`(按需按钮,本 slice 先放占位/最小)+ `inputEl`(禁用 + 占位「聊天 Agent(待实现)」)。3 种消息类型(discriminated union,per-message `Component` 生命周期,复用现 `scheduleRender` 合并/unload 模式但 per-message 而非单 synthEl,防泄漏 spec D6):`user-action`{id,label,icon?}、`agent-reply`{id,markdown,streaming,stop?,affordance?:'save'}、`error`{id,message}。汇总渲染为单条增长的 `agent-reply`(markdown 随 chunk 累积,streaming true→false),停止按钮在气泡内(替换 `LoadingNotice` 的 stop);streaming 完成后 `affordance:'save'` 出现 → 点保存触发 `user-action`(「存回笔记」)+ `agent-reply`(「已存为综合笔记 [[汇总-XX]]」)消息对(走 slice 01 的 save 路径)。消息跨上下文切换持久(`renderContext` 不清 `messagesEl`,反馈 #2)。新消息自动滚到底,用户上滚暂停自动滚直到回到底。无消息数量上限。提取此 slice 仍走 Notice(暂时不对称,slice 04 迁移)。

**Blocked by:** 01(存回路径:汇总消息的保存 affordance 调 slice 01 的 `saveSynthesisAsNote`)

**Status:** ready-for-human

- [ ] 消息协议类型 + per-message `Component` 生命周期(每条消息独立 load/unload,卸载/视图关闭兜底 unload,防泄漏 D6)。流式汇总复用现 `scheduleRender` 去重/串行/renderGen 自废模式,但作用于 per-message Component。
- [ ] `AiPanelView` 重构:`actionsEl`/`synthesisEl`/`chat-placeholder` → `messagesEl` + `buttonRowEl`(先放最小占位,门控逻辑 slice 03)+ `inputEl`(disabled + placeholder)。`onContextChange` → 只重渲 `buttonRowEl`,不清 `messagesEl`。
- [ ] 汇总 streaming → 单条 `agent-reply` 增长 + 停止按钮在气泡内(AbortController 贯穿,替换 `LoadingNotice`);失败 → `error` 消息(非 abort 错)。
- [ ] 保存 affordance:`agent-reply` streaming=false 后 `affordance:'save'` 出现 → 点 → `user-action` + `agent-reply`(「已存为综合笔记 [[汇总-XX]]」)消息对,调 slice 01 的 `saveSynthesisAsNote`。
- [ ] 自动滚到底 + 用户上滚暂停(检测 scroll 距底 threshold,回到底恢复)。
- [ ] `styles.css` 重构(Obsidian CSS 变量随主题):`.shiyue-ai-panel` 容器保留;`.shiyue-msg` + 变体 `--user`(右对齐 accent 底)/ `--agent`(左对齐默认底)/ `--error`(`--background-modifier-error` 底)/ `--streaming`(光标动画);`.shiyue-ai-input`(禁用样式 + 占位灰);`.shiyue-ai-button-row`;`.shiyue-page-jump` 保留(decoratePageJumps 复用)。`.shiyue-ai-synthesis`/`.shiyue-ai-synth-save` 废弃。
- [ ] i18n 新 key(zh-CN+en,`satisfies` 双译):消息/占位/停止按钮/已存提示。LLM prompt 不 i18n。
- [ ] 现有 170 测试绿(面板交互测迁移到消息模型)。
- [ ] 手验:打开 KP → 点汇总 → 汇总以消息形式增长(可停止)→ 完成后显保存按钮 → 点保存 → 出现「已存为综合笔记」消息;切换上下文/导航 → 消息不清;关面板再开 → 消息清(内存,跨会话不持久 = 预期)。
