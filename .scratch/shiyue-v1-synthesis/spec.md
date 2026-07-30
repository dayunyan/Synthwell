---
Status: ready-for-agent
---

# 拾阅 / Shiyue — v1 汇总(RAG Synthesis)spec

> **日期**:2026-07-29
> **状态**:ready-for-agent
> **前置**:Phase 1 AI 抽取设计(`docs/superpowers/specs/2026-07-27-phase1-ai-extraction-design.md` §6 KnowledgePanel)、工作区 v1 设计(`docs/superpowers/specs/2026-07-28-shiyue-workspace-design.md`)、grill-with-docs 决策(`CONTEXT.md` + `docs/adr/0002`/`0003`)
> **取代**:Phase 1 spec §6 KnowledgePanel 的「打开笔记 + 命令 + 右侧独立 view」入口——改为复用 AI 面板上下文切换(见 Implementation Decisions)。

---

## Problem Statement

拾阅把 PDF 抽成知识点笔记、喂 Obsidian 自带图谱——但图谱现在只是**孤立节点的浏览视图**:点一个知识点,看不到它和别的知识点(跨书、跨章节)怎么关联、关联处原文说了什么。

这正是 3 位实测用户里 user3 的警告——图谱「演示惊艳实际玩具」。Phase 1 验证目标写的是「用户真用图谱 + AI 摘要(对冲玩具风险)」,但工作区 v1 设计漏建了「AI 摘要」这一半(AI 面板「聊天 Agent(待实现)」占位 ≠ 汇总,见 ADR-0002)。没有汇总,图谱就无法回答「这个知识点和别的怎么连」,「玩具」风险坐实。

用户要的是:**打开一个知识点 → AI 围绕它综合所有关联知识点 + 它们的原文片段 → 带引用溯源的综合摘要**,让图谱从浏览层升为关联/综合层。

## Solution

点开一个知识点笔记时,拾阅 AI 面板从「PDF 抽取模式」切换到「汇总模式」,显示「汇总这个知识点」按钮。点按钮 → 拾阅找出与当前知识点**共享 ≥1 标签**或**有 `[[backlink]]` 指向/来自当前笔记**的关联笔记(限 20)→ 把当前知识点 + 各关联笔记的 summary + 原文片段 + 关联理由喂给 AI → AI 产出带 `[[笔记]](pN)` 引用溯源的综合摘要,流式渲染在面板里。引用可点 → 跳到该笔记。

关联靠 tag/backlink,**无向量**(向量是 Phase 1.5)。冷启动关联稀疏时**诚实降级**而非编造:关联笔记 ≤1 时产出「单篇聚合视图」(各点 summary + 原文)+ 标注「关联少;随抽取更多文档,汇总将跨文档综合」。

## User Stories

1. 作为拾阅用户,我打开一个知识点笔记时,AI 面板自动从「抽取按钮」切换成「汇总按钮」,这样我不用手动找入口。
2. 作为拾阅用户,我点「汇总这个知识点」,AI 围绕这个知识点综合它的关联笔记,这样我一次看到这个知识点的全貌而非孤立一条。
3. 作为拾阅用户,汇总输出里每条事实后跟 `[[笔记]](pN)` 引用,这样我知道这条综合出自哪篇笔记哪一页。
4. 作为拾阅用户,我点汇总里的 `[[笔记]](pN)` 链接,跳到那篇笔记,这样我能溯源核实。
5. 作为拾阅用户,汇总流式输出,这样长摘要不用等完才看到。
6. 作为拾阅用户,当这个知识点还没关联笔记时,汇总给我「单篇聚合视图」+ 诚实说明关联少,这样我不会误以为汇总坏了,也知道随抽取更多文档它会变强。
7. 作为拾阅用户,汇总进行时面板显示可取消的 loading(与抽取一致),这样大汇总我能中断。
8. 作为拾阅用户,汇总取消后已流式出的部分保留可见,这样我不丢失已生成内容。
9. 作为拾阅用户,关联笔记按「强关联优先」排序(带关联理由的 > 纯 tag 共享的),这样综合摘要聚焦最相关的笔记。
10. 作为拾阅用户,关联笔记限 20 条,这样大 vault 不会把汇总喂爆 token。
11. 作为拾阅用户,我回到 PDF 预览(离开知识点笔记)时,AI 面板自动切回「抽取按钮」,这样两种模式不互相干扰。
12. 作为拾阅用户,汇总的视觉风格与 Obsidian 原生一致(CSS 变量),这样不显得突兀。
13. 作为拾阅用户,我能选「把汇总追加到当前笔记的 `## 综合汇总` 章节」,这样综合结果沉淀回知识库。
14. 作为拾阅用户,汇总失败(网络/key/超时)时面板给友好提示并保留已生成内容,这样我不丢工作。
15. 作为拾阅用户,汇总只对知识点笔记生效(`shiyue_type: knowledge_point`),普通 markdown 笔记不触发汇总模式,这样面板不会误切。
16. 作为拾阅用户,没有 API key 时汇总按钮禁用 + 引导配置,与抽取行为一致。
17. 作为拾阅用户,汇总出的引用页码正确(关联笔记的 `source_page`),这样溯源跳转准。
18. 作为拾阅用户,跨书的关联笔记(不同 `source_pdf`)也被纳入综合,这样汇总体现跨文献关联——这是它的真价值。

## Implementation Decisions

### 模式切换:复用 AI 面板,不新建 view(取代 Phase 1 spec §6 的独立 KnowledgePanel view)

AI 面板(`shiyue-ai-panel` view)根据**当前激活 leaf 的文件类型**上下文切换:
- 当前是 PDF 预览 → 面板显示「抽取整篇 / 选区知识点提取」两按钮(现状)。
- 当前是知识点笔记(`shiyue_type: knowledge_point` frontmatter)→ 面板显示「汇总这个知识点」按钮 + 汇总结果渲染区。
- 当前是普通 markdown / 无文件 → 面板禁用抽取按钮(现状的「无文件禁用」延伸)。

**触达路径(R1)**:点图谱节点 → Obsidian 原生打开笔记(可能替换图谱页,可接受)→ `active-leaf-change` / `file-open` 被动观察 → 面板检测到知识点笔记 → 切汇总模式。**零 monkey-patch,全公开 API。** R2(汇总时图谱保持可见)延后(ADR-0002 / CONTEXT「R1 vs R2」)。

### PanelTracker 扩展:从「只跟 PDF 预览」到「跟当前激活文件 + 其类型」

现有 `PreviewTracker`(跟预览 leaf 的 `TFile`)扩展为跟踪**当前激活 leaf 的文件**,并暴露其是否知识点笔记(读 frontmatter `shiyue_type`)。面板经 `onFileChange` 收到 `{file, isKnowledgePoint}` 后切换按钮组。`active-leaf-change` 是切换的驱动事件(非 file-menu,非劫持)。

### 关联筛选(无向量,纯 tag/backlink)

给定当前知识点笔记,关联笔记 = `拾阅笔记/知识点/` 下满足任一的笔记(限 20,强关联优先排序):
- **共享 ≥1 标签**(frontmatter `tags`)。
- **有 `[[backlink]]` 指向或来自当前笔记**(frontmatter `related` 字段里的 `[[标题]]`,或正文 `[[当前笔记标题]]`)。

排序:**带关联理由的(related_reasons 非空,即当初抽取时 AI 判过强关联)> 纯 tag 共享的**;同档按 `source_page` 或文件名稳定排序。>20 截断。

### 关联理由统一:batch 也带理由(ADR-0002 落地)

当前 `related` 字段两种形状:batch 是 `string[]`(纯标题),selection 是 `{title, reason}[]`。**统一为 `{title, reason}[]`**:
- batch 的 `extractChunk` prompt 改为要求 `related: [{"title","reason"}]`。
- `normalizePoint`(`core/extraction/normalize.ts`)从处理 `string[]` 改为处理 `{title, reason}[]`(兼容 LLM 仍返字符串的退化)。
- 笔记 frontmatter `related` 渲染统一带理由(已有 `related_reasons` 字段,note-generator 已支持,body `## 关联` 已渲染理由)。

理由喂进汇总 prompt,让综合 AI 不必重新推断关系(CONTEXT「关联理由」三层用处)。

### Synthesizer(新 core/extraction 纯逻辑,本 spec 的测试 seam)

```typescript
interface SynthesisInput {
  current: { title: string; summary: string; source_pdf: string; source_page: number; tags: string[] };
  associated: Array<{
    title: string; summary: string; source_pdf: string; source_page: number;
    source_text: string; reason: string;  // reason=关联理由(空=纯 tag 共享)
  }>;
}
interface SynthesisResult {
  markdown: string;       // 带 [[笔记]](pN) 引用的综合摘要(honest-sparse 时为单篇聚合 + 标注)
  sparse: boolean;        // 关联≤1 → true(controller 据此决定是否提示)
}
class Synthesizer {
  constructor(llm: LLMProvider) {}
  async synthesize(input: SynthesisInput, signal?: AbortSignal): Promise<SynthesisResult>;
}
```

- `synthesize`:关联 ≤1 → 不调 LLM,直接组「单篇聚合视图」markdown + `sparse:true`(省 token、诚实)。>1 → 组 prompt(当前知识点 + 各关联笔记 summary + 原文片段 + 关联理由)→ LLM 流式/非流式 → 解析,确保 `[[笔记]](pN)` 引用格式。
- prompt 要求 AI「每个事实后用 `[[笔记标题]](p页码)` 标注来源」;输入里每个关联笔记带 `reason`,AI 据此聚焦强关联。

### 数据层:无新存储

汇总不写文件(除非用户选「追加到 `## 综合汇总`」)。关联筛选读现有 `拾阅笔记/知识点/**/*.md` 的 frontmatter。无新 schema 字段(见 Out of Scope 的「向量」)。

### 命名:shiyue_type(ADR-0001)

知识点笔记 frontmatter 标识键从 `synthwell_type` 改为 `shiyue_type`(趁未发布、零存量)。本 spec 的关联筛选按 `shiyue_type: knowledge_point` 判定。代码端重命名与汇总一并落(note-generator + 其测试)。

### 渲染 + 生命周期(spec D6)

汇总结果用 `MarkdownRenderer.render()`(非 deprecated `renderMarkdown`)+ Component 生命周期管理:替换/取消时 `unload()` 旧 Component,避免 hover-link / 后处理器泄漏。`[[笔记]](pN)` 渲成可点链接,点击 → `workspace.openLinkText` 打开该笔记(原生,不跳页——页码溯源靠引用文本可见,跳页延后)。

### 取消 + loading(与抽取一致,ADR-0003 风格)

`AbortController` 贯穿 `Synthesizer.synthesize` → `llm.chat({signal})`(provider 已支持 signal,零改)。汇总进行时面板/Notice 显示可取消 loading(复用 `LoadingNotice` 或面板内 inline spinner)。取消后已流式部分保留。

## Testing Decisions

### 一个 seam:`Synthesizer`(core/extraction,纯逻辑)

最高 seam:注入 mock `LLMProvider`(返 canned synthesis 文本),端到端测 `synthesize` 的行为。与 `BatchExtractor`/`SelectionExtractor` 同一模式、同一 mock 套路(先例:`batch-extractor.test.ts`、`selection-extractor.test.ts`)。

**测什么(只测外部行为,不测实现细节):**
- 关联筛选:共享 tag / backlink 命中;>20 截断;强关联(reason 非空)优先排序。
- honest-sparse:关联 ≤1 → 不调 LLM、返 `sparse:true` + 单篇聚合 markdown(断言 markdown 含各点 summary + 诚实标注)。
- prompt 组装:喂进 LLM 的 prompt 含当前知识点 + 各关联笔记 summary + source_text + reason(用 captured prompt 断言)。
- 引用格式:LLM 返的文本里 `[[笔记]](pN)` 保留(或 Synthesizer 规范化之)。
- 取消:`signal.aborted` → 不抛、返已组部分 / 空。

**不测(实现细节):** 内部排序算法的具体步骤、prompt 字符串逐字(只断言关键要素在)。

### normalize 改造的回归测试

`normalizePoint` 从 `related: string[]` 改为 `{title,reason}[]` —— 现有 `batch-extractor.test.ts` 的 tag/related 断言需更新;新增「LLM 返字符串 related 的退化兼容」测试。

### Obsidian 耦合部分:人工验(不单测)

与现有 `workspace/`+`preview/` 一致,人工验:
- 打开知识点笔记 → 面板切汇总模式;回 PDF → 切回抽取。
- 汇总流式渲染 + `[[笔记]](pN)` 可点跳转。
- 取消 loading + 已生成部分保留。
- 风格与 Obsidian 一致(CSS 变量)。
- `active-leaf-change` 驱动切换稳定(切快不抖)。

## Out of Scope

- **R2(汇总时图谱保持可见)**:需劫持图谱点击 / 验证 `file-menu` 是否从图谱触发,延后(CONTEXT「R1 vs R2」)。R1(可触达)已答「玩具」风险。
- **向量语义检索**:Phase 1.5。汇总靠 tag/backlink;honest-sparse 不提前引入向量补冷启动空窗(CONTEXT「honest sparse」)。
- **聊天 Agent**:自由 NL 驱动工作区工具调用,独立范畴,后期把「汇总」包成一个 tool(ADR-0002)。AI 面板「聊天」占位保留,本 spec 不碰。
- **图谱节点右键「在拾阅中打开」**:无公开 hook,延后。
- **高亮 overlay**:PDF++ 领域,延后。
- **跳转到引用的具体页**:`[[笔记]](pN)` 可点开笔记,但不跳到 PDF 第 N 页(需 openInShiyue + page 定位,延后)。
- **`file-menu` 是否从图谱触发**:待测试 vault 实测的假设,R2 用得到,不阻塞本 spec。

## Further Notes

- **实现顺序(ADR-0003)**:Bug 1+3 → Bug 4(浮按钮)→ **本汇总核心** → i18n。本 spec 对应第三件。i18n 最后会重写汇总的新 user-facing 字符串(「汇总这个知识点」等),故本 spec 的字符串是中文占位,i18n 阶段统一抽 locale。
- **关联理由落地依赖**:汇总的强关联排序/喂 prompt 依赖 batch `related` 统一带理由(见 Implementation Decisions)。该改造与汇总同批做,或在汇总前一步做——`/to-tickets` 时作为汇总的 blocking edge 或前置 ticket。
- **冷启动现实**:跨文档综合的真价值随用户笔记积累(数周到多月)才浮现。honest-sparse 让单篇聚合视图立即可用,不假承诺。验证目标「用户真用图谱 + AI 摘要」由「汇总存在且可触达」回答,不依赖关联密度。
- **prompt 语言**:LLM prompt 是中英混合指令(给模型的),不随 i18n 改——改语言可能影响质量。仅 user-facing 字符串走 i18n。
