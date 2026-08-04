# 04 — 提取迁移到消息

**What to build:** 提取(`extractBatch`/`extractSelection`)的进度与结果从 `LoadingNotice`+`Notice` 迁移到消息协议:streaming `agent-reply` 流式显进度(状态文本增长「0/12 块」→「已抽 N 个知识点,入库」),成功终态为该 reply 的最终消息,失败为 `error` 消息。`confirmCost` 模态保留(预操作门,user-action + agent-reply 仅在确认后出现)。命令面板等非面板触发的提取保留 `Notice`(迁移仅 AI 面板路径,反馈 #6)。这消除 slice 02 起的「汇总走消息、提取走 Notice」暂时不对称,统一协议:每个按钮 → user-action + agent-reply。

**Blocked by:** 02(消息协议 + `user-action`/`agent-reply`/`error` 类型),03(提取按钮活在 03 门控的 buttonRowEl 上;disabled 态/选区/提取进行中整排禁用由 03 立)

**Status:** ready-for-agent

- [ ] `extractBatch` 面板路径:`user-action`(「提炼全书要点」)+ `confirmCost` 门 → 确认后 streaming `agent-reply`(进度「0/total」→ `onProgress` 更新文本「done/total,已抽 points 个」)→ 成功终态消息(「已抽 N 个知识点,入库 notesPath」)/ 取消(「已取消」)/ `error`(失败)。停止按钮在气泡内(AbortController)。
- [ ] `extractSelection` 面板路径:`user-action`(「提炼选中要点」)+ streaming `agent-reply`(进行中文本)→ 成功终态(「已提炼:<title>」)/ `error`。无 confirmCost 门(selection 无门,与现状一致)。
- [ ] `ExtractionController` 的 `LoadingNotice`/`Notice` 在面板路径换成回调钩子(onProgress/onSuccess/onError/onCancel → 面板转消息);命令面板路径(无面板上下文)保留 `Notice`。controller 不直接渲染消息(保持无 UI 依赖),由面板据回调转消息。
- [ ] `error` 消息样式(slice 02 已立 `--error` 变体)承接提取错误;停止按钮复用 slice 02 的 streaming reply 停止。
- [ ] i18n key(zh-CN+en):提取进度/成功/取消消息模板(复用现有 `extract.*` key 文案,适配消息上下文)。
- [ ] 现有 170 测试绿;提取相关测迁移到消息回调模型。
- [ ] 手验:面板内抽整篇 → 进度流式消息增长 → 成功终态消息;面板内抽选区 → 进行中消息 → 成功终态;失败 → error 消息;命令面板触发抽取 → 仍走 Notice(非面板);停止按钮中断 → 「已取消」消息。
