# 拾阅 AI 面板 — 聊天式重构 spec

> **源**:`.scratch/chat-agent/brief.md`(2026-08-03,用户 #07 implement 后反馈 5 项 = 一件大事:面板重构)+ `/grill-with-docs` 决策树。
> **产物**:本 spec → `/to-tickets`(各 ticket 带 blocking edges)→ `/implement`(fresh session per ticket)。
> **范围**:把 AI 面板(`shiyue-ai-panel` view)从「按钮 + 单 synthesisEl」重构成聊天式消息 UI(shell + 按钮即 tool),synthesis 存为图谱节点(综合笔记)。**不实现** NL 解析(聊天 Agent 留位)。
> **术语**:见 `CONTEXT.md`——AI 面板(对话式宿主 shell)、聊天 Agent(未来 NL 引擎,留位)、综合笔记(汇总持久化产物,synthesis 类型节点)、汇总(RAG 合成过程)。
> **ADR**:[0006](../../adr/0006-synthesis-saved-as-graph-node.md)(综合笔记存为图谱节点,非 `## 综合汇总` 章节)。

## 1. 范围与非目标

**做**:消息 UI(shell)+ 按钮即 tool 分发 + 综合笔记节点(schema + 存/更)+ 提取迁移到消息 + Notice→消息迁移(面板内)+ 样式重构。

**不做**:NL 输入解析(聊天 Agent 留位,输入框禁用占位);跨会话消息持久化(内存);消息数量上限;阅读视图 `(pN)` 装饰(记为后续货,ADR-0006 Consequences)。

## 2. 术语与文档变更(已落)

- `CONTEXT.md`:AI 面板 / 聊天 Agent 分立(宿主/租客);新增**综合笔记**条目(synthesis 类型节点,`synthesized_from` 双链为图谱边,tags 非边)。
- `docs/adr/0006`:综合笔记存为节点(schema + 重汇总=更新 + Consequences:`## 综合汇总` append 废弃、`(pN)` 阅读视图装饰后续货)。

## 3. 消息协议

每条消息 = 一个 `Component`(D6 生命周期,per-message load/unload,防泄漏——复用现 `scheduleRender` 合并/unload 模式但 per-message 而非单 `synthEl`)。

**3 种类型**(discriminated union):

- **`user-action`** `{ id, label, icon? }` — 按钮触发的动作(「提炼选中要点」/「汇总关联笔记」/「存回笔记」)。右对齐用户气泡。
- **`agent-reply`** `{ id, markdown, streaming: boolean, stop?: () => void, affordance?: 'save' }` — tool 输出。streaming 期显停止按钮 + markdown 增长;streaming=false 停止按钮消失,汇总则 `affordance:'save'` 出现。左对齐。
- **`error`** `{ id, message }` — tool 失败(替换面板路径 Notice)。红底样式,无 streaming/save。

**关键行为**:

1. 流式汇总 = 单条 `agent-reply` 增长(markdown 随 chunk 累积,streaming true→false),非「进度→回复」两段。
2. **提取迁移到消息**:`LoadingNotice`(spinner+stop)→ streaming `agent-reply`(状态文本增长「0/12 块」→「已抽 N 个知识点,入库」);成功/失败 Notice → 该 reply 终态 / `error` 消息。`confirmCost` 模态保留(预操作门,非消息);user-action + agent-reply 在确认后才出现。
3. **消息持久(不随上下文切换清)**:messagesEl 不被 renderContext 清(反馈 #2)。切上下文只改按钮排(context-aware),消息日志累积(会话内,内存)。
4. **保存按钮跟随汇总回复**:点 → 在汇总 `agent-reply` 气泡后渲染 `user-action`(「存回笔记」)+ `agent-reply`(「已存为综合笔记 [[汇总-XX]]」)。反馈 #1(保存时机)自然解决。
5. **停止按钮在 streaming reply 内**(替换 LoadingNotice 的 stop)。

## 4. 工具集与按钮排门控

**按钮分发的 tool(4)**:`extractBatch`、`extractSelection`、`synthesize`、`saveSynthesisAsNote`。
**消息内调的 tool(2)**:`openInPreview`(`[[笔记]]` 链接点)、`openSourcePage`(`(pN)` 页码跳转)。

**新增 `PanelContextKind = "synthesis"`**(改 `classifyContext`:md + `shiyue_type === "synthesis"` → synthesis)。经 `derivePreviewContext` 自动透传。

**按钮排门控(4 态)**:

- **pdf** → 「提炼全书要点」+「提炼选中要点」(两常驻)。
  - 「提炼选中要点」:**无选区时 disabled(灰)**(不弹 error)。需 `onSelectionChange` 订阅(PanelActions 新方法,与 onContextChange 并行,反映 SelectionCache 状态)。
  - 提取进行中:整排按钮 disabled(`setExtracting` 开关;`attachSelectionCapture` 现有机制,验证后复用)。
- **knowledge-point** → 「汇总关联笔记」(常驻)。点击时 lazy 查 `<synthesisPath>/汇总 - <basename>.md` 存在 → **确认覆盖模态**(「已存在综合笔记,重新汇总将覆盖,继续?」)→ 更新 / 取消(满足 ADR-0006 Consequences「UI 提示覆盖」)。
- **synthesis** → **无操作按钮**;信息提示「综合笔记 — 汇总自 N 个知识点」(N = `synthesized_from` 长度)。综合笔记是已存结果,无再操作入口;重新汇总从源 KP 上下文触发,不从综合笔记触发。
- **none** → 禁用占位(现状)。

**浮动「精读选中」按钮**:`attachSelectionCapture` 仅在 PDF 上下文挂;笔记/md 上下文不挂(**修复**——现状笔记上下文也出浮动按钮,点击失败 `notice.noPdf`)。

## 5. 综合笔记 schema(ADR-0006)

- **路径**:`<synthesisPath>/汇总 - <trigger KP basename>.md`。`synthesisPath` 新 setting,默认 `拾阅笔记/汇总`(与 notesPath 默认 `拾阅笔记/知识点` 平行,扁平——综合笔记跨书,不按书分)。
- **文件名**:`汇总 - <trigger basename>.md`,稳定(无日期——更新策略)。`汇总 -` 前缀 file-explorer 排序归组。
- **frontmatter**:
  - `shiyue_type: synthesis`
  - `synthesized_from`:源知识点 `[[KP]]` 双链列表(`- "[[KP A]]"`...),图谱边。
  - `synthesized_at: <date>`(重汇总更新)
  - `model: <llm>`(溯源)
  - `tags`:全部源知识点 tags 去重并集(供标签面板/过滤,**非图谱边**——分层靠 `synthesized_from`)
  - *omit* `source_pdf`/`source_page`(跨 PDF)、`related`(源是输入非 peer)、`source_text`(无单源)、`trigger`(= 文件名 + `synthesized_from` 之一,冗余)
- **body**:`# 汇总 - <trigger title>` + Synthesizer 流式输出原样(`[[笔记]](pN)` 溯源)。无 `## 原文`/`## 关联` 块(知识点专属)。

**重汇总 = 更新**:一触发 KP 一综合笔记。存在 → 覆盖 body + bump `synthesized_at`/`model`/`synthesized_from`/`tags`。文件名稳定。

**纯 seam**:`saveSynthesisAsNote`(新,纯逻辑:`buildSynthesisNoteContent(trigger, sources[], synthesisMd, model) -> string` + `resolveSynthesisPath(trigger, synthesisPath) -> string`),单测覆盖(对照 `renderNote`/`appendSynthesisSection` 先例)。`SynthesisController.saveToNote` → `saveSynthesisAsNote`(`vault.process` 原子写,存在则 read-modify-write 覆盖 body+fm,新建则 create)。

## 6. UI 结构与样式

**布局(标准 chat,B)**:
```
┌─────────────────────┐
│ messages (scroll)   │  ← messagesEl:auto-scroll 底,用户上滚暂停
│ ...                 │
├─────────────────────┤
│ [提炼选中] [汇总…]  │  ← buttonRowEl:context-aware 门控
├─────────────────────┤
│ [input box]         │  ← inputEl:disabled + 占位「聊天 Agent(待实现)」
└─────────────────────┘
```

**`AiPanelView` 重构**(`ai-panel-view.ts`):`actionsEl`/`synthesisEl`/`chat-placeholder` → `messagesEl`(消息流)+ `buttonRowEl`(按需按钮)+ `inputEl`(禁用占位)。`onContextChange` → 只重渲 `buttonRowEl`,**不清** `messagesEl`。

**样式(`styles.css`,Obsidian CSS 变量随主题)**:
- `.shiyue-ai-panel` 容器保留(view ID 不变)。
- `.shiyue-msg` + 变体 `--user`(右对齐,accent 底)/ `--agent`(左对齐,默认底)/ `--error`(`--background-modifier-error` 底)/ `--streaming`(光标动画)。
- `.shiyue-ai-input`(禁用样式,占位灰)、`.shiyue-ai-button-row`。
- `.shiyue-page-jump` 保留(消息渲染路径 `decoratePageJumps` 复用)。
- `.shiyue-ai-synthesis` / `.shiyue-ai-synth-save` 废弃(单 synthesis 区模式不复存在)。

## 7. Notice → 消息迁移(反馈 #6)

| 原 Notice | 迁移 |
|---|---|
| `LoadingNotice`(spinner+stop,汇总/提取) | streaming `agent-reply`(停止按钮在气泡内) |
| 错误 Notice(面板路径,如 `panel.err.synthesis`/`extract.fail`) | `error` 消息 |
| 成功 Notice(`extract.success`/`extract.generated`/`notice.synthSaved`) | `agent-reply` 终态(「已抽 N 个知识点」/「已存为综合笔记 [[X]]」) |
| `confirmCost` 模态 | 保留(预操作门) |
| 非面板触发(命令面板抽提取) | 保留 Notice(迁移仅 AI 面板路径) |
| `notice.noPdf`/`notice.selectText`/`notice.sourcePdfNotFound`/`notice.pageJumpUnavailable` | 视调用源:面板内 → `error`/按钮态;命令面板 → Notice |

## 8. 改动文件清单(预判,`/to-tickets` 细化)

- `src/workspace/panel-context.ts` — 加 `"synthesis"` kind + `classifyContext` 认 synthesis。
- `src/workspace/ai-panel-view.ts` — 整体重构(messagesEl/buttonRowEl/inputEl + 消息协议渲染 + per-message Component 生命周期 + 自动滚动 + `decoratePageJumps` 复用)。
- `src/workspace/shiyue-workspace.ts` — `PanelActions` 加 `onSelectionChange`、`saveSynthesisAsNote`(替换 `saveSynthesisToNote`);`ShiyueWorkspace` 实现二者;浮动按钮 PDF-only 挂载。
- `src/workspace/synthesis-controller.ts` — `saveToNote` → `saveSynthesisAsNote`(组源 KP 列表 + 调纯 seam)。
- `src/core/extraction/synthesis-note.ts`(新纯 seam)— `buildSynthesisNoteContent` + `resolveSynthesisPath` + 单测。
- `src/core/extraction/synth-section.ts`(`appendSynthesisSection`)— **废弃**(ADR-0006);其测可删或留作历史。`SynthesisController` 不再 import。
- `src/settings.ts` — 加 `synthesisPath`(默认 `拾阅笔记/汇总`)。
- `src/i18n/index.ts` — 新消息/按钮/占位/覆盖确认文案 key(zh-CN+en,`satisfies` 双译);LLM prompt 不 i18n。
- `styles.css` — 消息卡片 + 输入框 + 按钮排重构(Obsidian CSS 变量)。

## 9. 开放/后续货(不在本 spec 实现)

1. **`(pN)` 阅读视图装饰**(ADR-0006 Consequences):综合笔记在 Obsidian 原生阅读视图打开时,`(pN)` 渲纯文本(无跳转),`[[笔记]]` 双链仍可用。后续版本补 reading-view decorator(同 `decoratePageJumps` 逻辑挂 reading-view 渲染链)。**近期货**。
2. **NL 输入解析(聊天 Agent)**:输入框 v1 禁用;聊天 Agent 单独立项,接管输入框 + LLM 选 tool 替换按钮选 tool(`dispatchTool` seam 已留)。
3. **跨会话消息持久化**:v1 消息内存;后续视用不用再定。
4. **meta-synthesis / 综合笔记的再操作**:synthesis kind = 无操作;若将来要「围绕一个综合笔记再汇总」,另立决策(综合笔记能否成汇总输入)。

---

## Round 2 修订(2026-08-04,code-review + grill 出)

> 源:4 工单实现 + 人工验 + `/code-review`(fixed `7e9b9c4`)。Standards 轴 9 smells 全认可;Spec 轴 4 项用户澄清。本节修订 §3/§4/§7;新增 §10(refactor 批次)。

### §3 修订:user-action 时机(confirmCost 门先于气泡)

§3 原「每个按钮 → user-action + agent-reply」过时。**澄清**:confirmCost 门是**预操作门**——点「提炼全书要点」先弹预估花费模态,**消息流无任何气泡**;只有点「确认」后才弹 user-action + streaming agent-reply;撤回模态则无 user-action(静默)。selection 无门 → 点按钮即显 user-action。代码已实现(`onConfirmed` 调 `appendUserAction`);本修订只校正 spec 措辞。

### §4 修订:浮动按钮走消息协议(原「PDF-only 挂」扩展)

§4 原「浮动『精读选中』按钮 PDF-only 挂」仅定挂载范围。**新增**:浮动点击须在 AI 区生成 `user-action`(label 同「提炼选中要点」——同一操作两个触发入口),后续路径同「提炼选中要点」按钮(即 `runExtractSelection` 消息流)。路由用**控制反转**:`PanelActions.setDeepExtractHandler(fn | null)`——面板 onOpen 注册 `() => runExtractSelection()`、onClose 注销;`syncSelectionCapture` 用注册的 handler 作 `onDeepExtract`(无 handler 则退命令路径 Notice,防御性;面板与浮动同生共死,handler 恒在)。`selection-capture.ts` 不变(仍调无参 `onDeepExtract`)。

### §7 修订:link/page-jump 错误留 Notice(撤销该行迁移)

§7 迁移表原「`notice.linkNotFound`/`notice.pageJumpUnavailable` → `error`/按钮态」**撤销**。这类点击不生成 user-action → 错误消息对不合适,**留 `Notice`**。代码已 Notice,无改。其余 §7 行不变。

### 新增 §10:流式跨上下文切换生命周期 + refactor 批次

**§10.1 流式不随上下文切换中断**(Spec #4 + Standards #2):在飞 agent-reply(汇总 / 提取)跨上下文切换**继续完成**,不 abort + 「已取消」。`renderContext` 不再调 `finalizeStreaming*` 的 abort 分支;abort 仅在 `onClose`(面板销毁)发生。上下文切换时:
- `buttonRowEl` 仍按新上下文重渲(context-gating 不变),但 **streaming flag 覆盖 → 整排 disabled**(`syncButtons` 已有 `extracting` 机制,streaming 复用同信号,跨切换持续而非随 abort 清)。
- 在飞回复按 replyId 绑定其原触发文件(`saveTargets` 已对),完成后 save affordance 落该回复(原文件)。
- 输入框已永久禁用(v1 stub),不再加 cosmetic busy 态(已灰,二次灰是噪声)。

**§10.2 refactor 批次**(Standards 9 smells,见 `.scratch/chat-agent/issues/05-11`):
- 打包 `StreamingReplyState`(去重 `finalizeStreamingSynthesis`/`finalizeStreamingExtraction` + clump `synthAbort`/`synthReplyId`、`extractAbort`/`extractReplyId`)——与 §10.1 同代码段,先打包(prefactor)后改行为(§10.1)。
- 提 `resolveRunCtx`(`extractBatch`/`extractSelection` 重复三元组)、`settle`→`returnResultWithNotice`、`ExtractionFinalizeActions`→`ExtractionTerminal`(Primitive Obsession + Speculative Generality)。
- 拆 `agent-reply-entry.ts`(`AgentReplyEntry`/`MessageEntry`/`StaticEntry` 移出 `ai-panel-view.ts`,对齐 `chat-message.ts`/`extraction-messages.ts` 拆分)。
- `saveSynthesis` 链接标签 `汇总 - ${file.basename}` 提到 seam 作 `synthesisLinkLabel(trigger)`(Feature Envy + Shotgun Surgery,与 `resolveSynthesisPath` 同居)。
- `synthesisNoteExists` middle-man:接受为 PanelActions seam 代价(保留)或直调 controller——grill 定保留(seam 一致性 > 一行透传)。
