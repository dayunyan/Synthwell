# 拾阅 / Shiyue

Obsidian 插件,从 PDF 抽取知识点笔记喂 Obsidian 自带图谱。CJK-first;阅读器为基础设施,AI 知识点抽取 + 图谱导航为核心价值。详见 `docs/agents/` 与 `docs/superpowers/specs/`。

## Language

**拾阅 / Shiyue**:
本插件与产品的唯一正式名称。仓库名 `Synthwell` 仅为历史目录名,不再作为产品/代码/数据标识。
_Avoid_: Synthwell(产品名)、Glean(与 Glean.com 冲突,已弃)、合阅(旧译名)

**知识点 (Knowledge Point)**:
从 PDF(整篇批处理 / 选区深抽)提取的一条离散知识,以一条 Obsidian 笔记入库,带 `[[源PDF]]` 双向链接 + tags + `[[related]]` 关联,参与图谱。
_Avoid_: note(泛指)、summary(是知识点的一部分)、point(口语)

**抽取 (Extraction)**:
AI 从 PDF 文本产出知识点的过程。两种模式:`batch`(整篇分块 map-reduce 去重)与 `selection`(选区 + ±2 页上下文单点深抽)。
_Avoid_: 抽取 vs 提取不混用;统一用「抽取」
_Note_: 域词「抽取」不变;但 user-facing 按钮措辞经 #06 措辞优化改用「提炼全书要点」/「提炼选中要点」/「精读选中」(浮按钮)——动作即抽取,仅 UI 标签换词,非混用「提取」。汇总按钮用「汇总关联笔记」(域词「汇总」不变)。

**汇总 (RAG Synthesis)**:
打开一个知识点 → AI 围绕它综合**已有笔记**(共享 tag / `[[backlink]]` 关联的笔记)+ 它们的原文片段,产出带 `[[笔记]](pN)` 引用溯源的综合摘要,存为一条**综合笔记**(图谱节点)。无向量,靠 tag/backlink 关联。
_Avoid_: 与「抽取」混——抽取从单篇 PDF 产新知识点;汇总是跨已有知识点综合,产物是综合笔记(非知识点)。与「聊天 Agent」混——汇总是一条确定的「点节点→综合关联」操作,聊天是自由 NL 驱动工具调用。后者后期会把前者包成一个 tool。

**综合笔记 (Synthesis Note)**:
一次汇总的持久化产物:一条入图谱的笔记,类型 synthesis(区别于知识点 knowledge_point——后者从单篇 PDF 抽取,综合笔记从已有知识点综合而来)。`synthesized_from` 链接其源知识点 + 正文带 `[[笔记]](pN)` 溯源。图谱中综合笔记居知识点之上 → 树状分层(知识点叶 → 综合笔记聚合层),分层靠 `synthesized_from` 双链(图谱边),非 tags。`tags` = 全部源知识点 tags 去重并集,供标签面板/过滤,不作图谱边。
_Avoid_: 知识点(从 PDF 抽取,叶;综合笔记从已有笔记综合,聚合层)、汇总节点/汇总笔记(口语,用综合笔记)

**AI 面板 (AI Panel)**:
右栏对话式宿主面板(view `shiyue-ai-panel`)。v1 由按钮快捷方式触发工作区工具(抽取 / 汇总 / 存回笔记…),工具结果以消息形式展在消息区;底部输入框留位(v1 不解析 NL)。聊天 Agent (NL 引擎) 将来接管输入框,把按钮触发改 LLM 触发——宿主不变,只换触发源。
_Avoid_: 聊天面板(易混聊天 Agent)、AI 助手(语义漂)

**聊天 Agent (Chat Agent)**:
自由自然语言驱动工作区操作的入口(openInShiyue / extractBatch / extractSelection / 汇总 等函数包装成 tool,LLM 调用)。v1 仅留位:不实现 NL 解析,按钮快捷方式先顶替(AI 面板宿主已建);逻辑单独立项。
_Avoid_: 不等于「汇总」——见上。不等于「AI 面板」——AI 面板是对话式宿主(壳),聊天 Agent 是将来住进其输入框的 NL 引擎(租客);宿主/租客,非同物。

**R1 vs R2(图谱→汇总触达,两条独立需求)**:
点图谱节点→汇总,实际是两件事——R1「触达汇总」(汇总存在且可触发)与 R2「汇总时图谱保持可见」(笔记在预览面板开、不替换图谱页)。v1 只做 R1(被动 `active-leaf-change`/`file-open` 观察,面板上下文切换;零 monkey-patch);R2(需劫持图谱点击 / 验证 `file-menu` 是否从图谱触发)延后。「图谱是不是玩具」风险由 R1 已回答——汇总存在且可触达,不依赖 R2。

**汇总的冷启动(honest sparse)**:
汇总靠 tag/backlink 关联,无向量(向量是 Phase 1.5)。冷启动(单篇 ~5-15 点,跨书关联几无)时关联稀疏。v1 不提前引入向量补这空窗,而是**诚实降级**:关联笔记≤1 时,产出「单篇聚合视图」(各点 summary + 原文片段)+ 标注「关联少;随抽取更多文档,汇总将跨文档综合」。不编造、不隐藏入口、不假承诺。跨文档综合的真价值随用户笔记积累自然浮现,不靠 Phase 1.5 工作强行填 v1 空窗。
_Avoid_: 「加向量让它好看点」——违背分阶段,且 vectra 脆(spec T7);「藏入口等笔记多」——夺走用户评判「图谱+AI 摘要真用不用」的验证目标。

**关联理由 (related reason)**:
知识点笔记 frontmatter `related` 字段里每条关联附的「为什么相关」一句。两种抽取模式**统一带理由**(batch 与 selection 对齐):batch 的 `extractChunk` prompt 也要求 `related: [{title, reason}]`,经 `normalizePoint` 归一。理由对汇总三层用处:① 决定关联笔记排序/取舍(带理由=AI 明确判过强关联,优先于 tag-only);② 喂进汇总 prompt 让综合 AI 不必重新推断关系;③ 渲染溯源更可信(`[[笔记]](pN) — 因为都讲飞轮效应`)。
_Avoid_: batch 保持纯标题 `string[]`——会让汇总对批处理笔记无理由可用,质量降级。统一带理由,在 normalize 信任边界改,不破 schema。
