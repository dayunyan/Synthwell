# 06 — 拆 `agent-reply-entry.ts`(Divergent Change,Standards #9)

**What to build:** 把 `AgentReplyEntry`/`MessageEntry`/`StaticEntry` 三个消息条目类从 `ai-panel-view.ts`(688 net,职责过多)移出到独立文件 `agent-reply-entry.ts`,对齐已有的 `chat-message.ts`(类型)/`extraction-messages.ts`(提取消息)拆分。`ai-panel-view.ts` 变薄,只留面板壳 + 消息分发 + 按钮门控 + 流式生命周期编排。

**Blocked by:** None — can start immediately(纯结构重构,无行为改)

**Status:** ready-for-agent

- [ ] 新 `src/workspace/agent-reply-entry.ts`:`MessageEntry`(abstract 基类)、`StaticEntry`(user-action/error)、`AgentReplyEntry`(markdown 渲染循环 + per-message Component 生命周期 + `decoratePageJumps`)移入。依赖:`App`、`chat-message.ts` 的 `AgentReplyMessage` 类型、`t`、`onRendered`/`onSave` 回调(构造注入)。无新逻辑,纯搬运。
- [ ] `ai-panel-view.ts` 从新文件 import 三类;移除类定义。`createEntry`/`saveSynthesis` 等引用不变(类接口不动)。
- [ ] 无外部引用这三类(`grep` 确认仅 `ai-panel-view.ts` 引用,无测直接测类)——搬移无调用方改。
- [ ] 现有测试绿(200);tsc + esbuild clean。
- [ ] 手验:打开面板 → 汇总流式渲染正常(per-message Component 生命周期不破),`(pN)` 跳转 + `[[笔记]]` 链接正常(渲染循环搬移不破 affordance)。
