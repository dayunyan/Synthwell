# 拾阅 / Shiyue — Phase 1 设计:AI 知识点抽取 + RAG 叠加层

> **日期**:2026-07-27
> **状态**:Phase 1(A3 混合)设计完成,待 review
> **前置**:产品 spec(2026-07-23)、spike 结果与重定位(2026-07-27)、Phase 1 设计骨架(已批准)
> **范围**:本设计只覆盖 Phase 1 = AI 知识点抽取(批处理 + 选区即抽,混合)+ 笔记生成 + 标签/backlink 关联 + 轻量 RAG 叠加层。向量语义检索延到 Phase 1.5,图谱可视化延到 Phase 2。

---

## 0. 目标与边界

**一句话**:让用户开 PDF 后,一键 AI 抽取整篇知识点大纲(批处理,快覆盖)+ 圈选精修单点(选区即抽),知识点以结构化 Obsidian 笔记入库、自动双向链接、喂 Obsidian 自带图谱;点任意知识点节点 → AI 汇总该点的所有关联笔记 + PDF 段落 + 引用溯源。

**做**:
- LLMService(BYO key,3 provider)
- 批量抽取器(chunk + map-reduce + 去重 + 跨点关联)
- 选区抽取器(选中段 + 上下文 + 已有笔记 → 单点深抽 + backlink)
- 笔记生成器(统一 schema,CJK 友好文件名,去重)
- RAG 叠加层 view(标签/backlink 关联 + AI 汇总 + 溯源,无向量)
- 设置面板(provider/key/模型/路径/费用预估)

**不做(延后)**:
- 向量语义检索(Phase 1.5;vectra 脆性,先验证用不用)
- 图谱可视化(搜索定位+高亮、问题→链路高亮;Phase 2,需测 Obsidian 图谱自由度 / 自建)
- annotation 渲染层重新启用(MVP)
- 英文选区偏移修复(MVP)
- 移动端

---

## 1. 架构

```
┌─────────────────────────────────────────────────────────────┐
│ 拾阅 Plugin (复用 PDF reader 基础设施 + spike 集成发现)       │
│                                                              │
│  ┌──────────────┐   选区   ┌──────────────────┐             │
│  │ PDF Reader   │────────→│ SelectionExtractor│             │
│  │ (PDFViewer)  │ 整篇   └────────┬───────────┘             │
│  └──────┬───────┘          ↓ context+已有笔记               │
│         │ 整篇              ↓                                  │
│  ┌──────▼───────────────────────────────────┐               │
│  │ BatchExtractor                            │               │
│  │  getTextContent → chunk → map(AI) → reduce(去重+关联)     │
│  └──────────────────────┬────────────────────┘               │
│                         ↓ 知识点列表 [{title,summary,page,tags,links}]│
│                  ┌──────▼──────┐                              │
│                  │NoteGenerator│ → 拾阅笔记/知识点/{源}/{标题}.md│
│                  └──────┬──────┘   (frontmatter + [[源PDF]] + tags + [[backlinks]])│
│                         │                                      │
│            ┌────────────┴─────────────┐                      │
│      Obsidian 自带 graph             KnowledgePanel (RAG 叠加层)│
│      (免费:节点=backlink/tag)        (点节点→AI 汇总+溯源)    │
│                                       ↑                      │
│  ┌──────────────────────────────────┐│                      │
│  │ LLMService                        ││                      │
│  │  ├─ OpenAI-compatible / DeepSeek  ││                      │
│  │  └─ Ollama (local)                ││                      │
│  │  + SecretStorage(key) + 费用预估  │└→ 用                  │
│  └──────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

5 组件 + Settings。**模块化**:extractor/RAG **不绑定** PDFViewer embed,依赖 `DocumentSource` 接口——换 Obsidian 自带预览器、或将来加 EPUB,只改接口实现,不动 extractor/RAG。

```typescript
/** 任何可被抽取的文档源都实现此接口。当前:PDF reader(PDFViewer embed)。
 *  未来可加:Obsidian 自带 PDF 预览器、EPUB reader。 */
interface DocumentSource {
  getFile(): TFile;                                      // 源文件(批处理/RAG 只需这个,不依赖 viewer)
  getDocument(): Promise<PDFDocumentProxy>;              // 加载 pdf 文档(批处理取文本用);非 PDF 源可返回 null
  getSelection(): { text: string; page: number } | null; // 当前选区(选区即抽用);无选区能力的源返回 null
}
```

- **批处理 + RAG** 只需 `getFile()`(+自己 `getDocument()` 取文本),**完全不依赖 viewer**——PDF 在 Obsidian 自带预览器里打开也能抽。
- **选区即抽** 需 `getSelection()`,即需一个能暴露选区的源(我们的 PDF reader 能;Obsidian 自带预览器选区能力有限,降级时只能走批处理)。
- spike 的 `src/pdf-view.ts` 实现 `DocumentSource`;extractor 注入 `DocumentSource`,不直接 import PdfView。

---

## 1.1 UX 入口(替换命令面板,Phase 1 必做)

E6 三位用户一致痛批「命令面板打开 PDF」反人类。Phase 1 必须改(#6):

- **双击 PDF → 用拾阅打开**:注册 `.pdf` 扩展名到拾阅 view(`registerExtensions(['pdf'], viewType)`)→ vault 文件列表双击 PDF 直接在拾阅 view 打开(像 Obsidian 原生打开 markdown 一样自然)。**推翻 V1.5 D8「不注册 .pdf」**——3/3 用户要,冲突风险(覆盖默认查看器)可接受;用户想用自带查看器可禁用拾阅或加 setting 切换。
- **当前编辑区新 tab 打开**(不是新 split):`getLeaf(true)`/`getLeaf('tab')`,不挤布局。
- **视图内工具栏**:PDF 视图顶部加工具栏(页码、缩放按钮、「抽取整篇知识点」按钮、暗色切换)——不是命令面板。spike 的 wheel 缩放 + autofit 保留。
- **右键菜单 + 选中浮工具栏**:选中文本后右键「深抽这个知识点」+ 浮起迷你工具栏(复制/深抽/问 AI)。

注:P4(双击打开 + tab)原在 spike 后置清单,现**提前到 Phase 1**(E6 一致要求 + #6)。

## 2. 数据层

| 路径 | 内容 |
|---|---|
| `拾阅笔记/知识点/{源basename}/{标题}.md` | 知识点笔记(用户可见,参与图谱) |
| `.shiyue/extraction-state.json` | 每个 PDF 的批处理状态(已抽/未抽、知识点列表 hash)→ 避免重复抽 + 增量 |
| `.shiyue/llm-usage.json` | 本月 token/费用计数(费用预估器用) |

**笔记 schema**(批处理 + 选区即抽共用):

```yaml
---
synthwell_type: knowledge_point
source_pdf: "[[书名.pdf]]"        # 双向链接到源 PDF(图谱连线)
source_page: 42                   # 抽自的页(批处理)/ 选中所在页(选区)
source_text: "原文片段…"          # 溯源/预览用,截断 ~200 字
extracted_at: 2026-07-27
model: deepseek-v4-flash
extraction_mode: batch | selection
tags:                             # AI 给的主题标签 → 图谱聚类
  - 飞轮效应
  - 增长策略
related:                          # AI 推断的关联知识点 → [[backlink]] 连线
  - "[[网络效应]]"
  - "[[好战略坏战略]]"
---
# {知识点标题}

{AI 生成的摘要,2-4 句,不含来源标记}

## 原文
> {完整原文}(不截断,完整保留抽取/选中段)

## 关联
- [[网络效应]] — {AI 一句话说明为何关联}
- [[好战略坏战略]]
```

设计要点:
- `source_pdf` 用 `[[书名.pdf]]` → 图谱里知识点笔记连到源 PDF 节点(免费)
- `tags` + `related` `[[backlinks]]` → 知识点之间连线 + 聚类(Obsidian graph 按标签染色)
- `synthwell_type: knowledge_point` frontmatter → 可用 Dataview/图谱过滤只看知识点
- 文件名:`{标题}.md`,CJK 友好(保留中文,去掉非法字符 `/ \ : * ? " < > |`,去首尾空格,截断 ~80 字符)。冲突时 ` - 2`、` - 3`

---

## 3. LLMService(AI provider 抽象)

接口:
```typescript
interface LLMProvider {
  chat(messages: ChatMsg[], opts?: ChatOpts): Promise<string>;
  stream(messages: ChatMsg[], opts?: ChatOpts): AsyncGenerator<string>;
  abort(): void;
}
interface ChatOpts { model?: string; temperature?: number; maxTokens?: number; signal?: AbortSignal; jsonMode?: boolean; }
```

实现(Phase 1 砍 Ollama,专注云端文本模型,纯文本处理):
- `OpenAICompatibleProvider`(baseURL + apiKey + model)——覆盖 OpenAI / DeepSeek(DeepSeek baseURL = `https://api.deepseek.com`,OpenAI 兼容协议)
- Settings 选 provider + 粘 key + 连接测试 + 选 model
- **默认 provider = DeepSeek,默认模型 = `deepseek-v4-flash`**(纯文本、高性价比)——实现期核对 DeepSeek API 真实模型 ID,以 API 文档为准
- 砍 Ollama 本地配置(Phase 1 不做;后续要本地再加)

**API Key 存储**:用 `app.secretStorage`(spec D5,`@since 1.11.4`),跨平台 per-vault。**不用** safeStorage+明文 fallback(spike D5)。

**费用预估器**:按选定 model 的单价(input/output ¥/1M tokens)+ `.shiyue/llm-usage.json` 本月累计 → Settings 显示「本月已用 X tokens / ≈¥Y」。批处理抽取前预估:「这篇约 N tokens,预计 ¥Z」。

**核心功能无 Key 也可用**:spec D4。但 Phase 1 全靠 AI,所以无 key 时批处理/选区抽/RAG 都不可用,Settings 引导配置。这和 spec「核心功能无 key 可用」有张力——但 Phase 1 的核心就是 AI,无法绕开。**决策**:Phase 1 的 AI 功能需要 key;阅读器(基础设施)无 key 可用。Settings 引导 + 费用预估降低门槛。

---

## 4. 批量抽取器(BatchExtractor)

**触发**:在 PDF 视图顶部工具栏的「抽取整篇知识点」按钮(主交互;命令面板 + 快捷键作为辅助入口,但不是主推)。**抽取前弹窗确认预估花费**(见下 token/成本)。

**pipeline**:
1. **取文本**:遍历 `pdfDocument.numPages`,`page.getTextContent()` → 拼每页文本(`items.map(i=>i.str).join("")`),记录每页文本 + 页码。复用 spike 的 `pageTextFromItems`。
2. **分块**:按 token 预算分块(默认 3000 tokens/块,重叠 200 tokens)。token 估算 ≈ 字符数/2(中英混合粗估)。块 = 连续页(不跨页切,便于 source_page 准确)。
3. **map**(顺序,带前文上下文):每块 → AI prompt(JSON mode)。**顺序注入此前已生成知识点的 schema + 摘要(不含完整原文,控 token)**,让 AI 能引用/链接前面的点(避免重复抽 + 形成关联):
   ```
   你是知识抽取助手。从下面这段 PDF 文本(来自《{书名}》第{页}-{页}页)提取离散知识点。
   每个知识点给:title(简短标题,名词短语)、summary(2-4 句摘要)、source_page(所在页码)、tags(2-3 个主题标签)、related(与本块或前文知识点中相关的标题列表)。
   只返回 JSON 数组,不要其他文字:[{"title","summary","source_page","tags","related"}]

   【此前已抽取的知识点(只看 schema+摘要,别复述原文)】:
   - {title1} — {summary1}
   - {title2} — {summary2}
   ...(限前 ~30 个,超了截断)

   文本:{chunk}
   ```
   解析 JSON(robust:去 code fence、失败重试一次「只返回 JSON」、再失败跳过该块 + 日志)。
4. **reduce**:合并所有块的知识点 → 去重(标题完全相同 / Jaccard 相似度 >0.8 合并摘要,保留更全的 summary + 合并 related/tags)。**跨点关联已在 map 阶段顺序建立**(每块看到前文点 + 给 related),reduce 不再额外 AI 调用。
5. **生成笔记**:每个知识点 → NoteGenerator → 写文件。进度条(Notice/Progress):「抽取中 块 3/8 → 知识点 17」。可 AbortController 中断。
6. **状态**:`.shiyue/extraction-state.json` 记 `{pdf_hash: {extracted_at, point_titles: [...], model}}` → 重复抽取时提示「已抽过 N 个知识点,重新抽 / 增量」。

**token/成本(不硬控,抽取前弹窗确认)**:大 PDF(800 页)→ 几十块 → 几十次 AI 调用。抽取前预估总 token + 费用,弹窗「《书名》约 N tokens / N 块,预计 ¥X,继续?」,用户确认才跑。**不设硬上限**——用户自己决定要不要为长文档付费。

**错误**:AI 失败(网络/key/超时)→ Notice 友好提示 + 中断 + 已生成笔记保留。JSON 解析失败 → 重试 + 跳过。

---

## 5. 选区抽取器(SelectionExtractor)

**触发**:PDF 视图里选中文本后,**右键菜单「深抽这个知识点」** + 选中后浮起的迷你工具栏按钮(主交互;命令面板作辅助)。

**输入**:
- `selected`:选中文字
- `page`:选中所在页(spike 的 `.page[data-page-number]` 祖先定位)
- `context`:当前页 ±2 页文本(从 pdfDocument.getPage(n).getTextContent)
- `existing_titles`:已有知识点笔记的标题列表(从 `拾阅笔记/知识点/` 扫,限 500 个,截断)→ 用于 AI 推断 backlink

**AI prompt**:
```
你是知识抽取助手。用户从《{书名}》第{page}页选中了一段,想把它抽成一个知识点笔记。
基于选中段 + 上下文,提取一个知识点:title(名词短语)、summary(2-4 句)、tags(2-3)。
并从已有知识点标题里找出关联的(给 related 列表,每个附一句关联理由)。
只返回 JSON:{"title","summary","source_page","tags","related":[{"title","reason"}]}

选中:{selected}
上下文(第{page-2}-{page+2}页):{context}
已有知识点:{existing_titles}
```

**输出**:1 个知识点 → NoteGenerator → 写文件 → 自动打开该笔记(用户立即看到结果)。

**复用**:选区定位已在 spike 的 `onSelectionEnd` 里实现(`.page[data-page-number]` 祖先 + `buildAnchor`)。SelectionExtractor 复用定位逻辑,只是把选中文字喂 AI 而非建文本锚。

---

## 6. RAG 叠加层(KnowledgePanel)

**触发**:打开任一知识点笔记 → 命令「拾阅: 汇总这个知识点」→ 右侧打开 KnowledgePanel view。

**关联(无向量,Phase 1)**:
1. 取当前知识点笔记的 `tags` + `related` `[[backlinks]]`。
2. 扫 `拾阅笔记/知识点/` 所有笔记,取:**共享 ≥1 标签** 或 **有 [[backlink]] 指向/来自当前笔记** 的笔记。限 20 个。
3. 取每个关联笔记的 `source_pdf` + `source_page` + `source_text`(溯源材料)。

**AI 汇总**(流式):
```
你是知识汇总助手。围绕「{当前知识点标题}」这个知识点,基于以下关联笔记 + 它们的原文片段,写一个综合摘要(4-8 句),整合不同来源的观点。每个事实后用 [[笔记标题]](p{页码}) 标注来源。

当前知识点:{title} — {summary}
关联笔记:
- [[笔记A]](p42):{summary} | 原文:{source_text}
- [[笔记B]](p108):{summary} | 原文:{source_text}
...
```
流式输出到 KnowledgePanel(MarkdownRenderer.render + Component 生命周期管理,spike D6)。

**溯源**:输出的 `[[笔记]](pN)` 渲染成可点链接 → 跳到该笔记 + 该页。

**保存**(可选):点「追加到当前笔记」→ 把汇总追加到当前知识点笔记的 `## 综合汇总` 章节。

**Phase 1 不做向量**:关联靠标签/backlink。代价:找不到「语义相关但没共标签/backlink」的笔记。Phase 1.5 加向量后补。

---

## 7. 错误处理与边界

| 场景 | 处理 |
|---|---|
| AI 网络失败/key 错/超时 | Notice 友好提示,中断,已生成笔记保留 |
| JSON 解析失败 | 重试一次「只返回 JSON」;再失败跳过该块/该次,日志,不崩 |
| 块超 token 上限 | 自动缩小块(减页)重试 |
| 文件名冲突 | ` - 2`、` - 3` |
| 重复抽取同 PDF | 状态文件提示,可选重抽/增量 |
| 无 API key | AI 功能禁用 + Settings 引导;阅读器仍可用 |
| 大 PDF 成本 | 抽取前预估 token/费用,用户确认再跑;设块数上限 |
| 关闭 view 中断 | AbortController,清理 |

---

## 8. 测试

**TDD,可单测的部分(不依赖真 AI)**:
- `LLMProvider`:mock provider(返回 canned JSON)→ 测 batch/selection pipeline 端到端(分块/解析/去重/笔记生成)。
- `NoteGenerator`:文件名 sanitize(CJK 保留、非法字符去、截断、冲突)、frontmatter 正确、dedup。
- `BatchExtractor`:map-reduce 去重(Jaccard)、跨点关联推断(mock AI 返回)、状态文件读写。
- `SelectionExtractor`:上下文组装(±2 页)、existing_titles 截断、backlink 推断。
- `KnowledgePanel`:关联筛选(共享标签/backlink)、汇总 prompt 组装、溯源链接。
- `LLMService`:provider 选择、SecretStorage 存取、费用计数。

**需真 AI/真 Obsidian 的(人工或集成测试)**:
- 真 DeepSeek 跑一篇 PDF 批处理 → 看知识点质量。
- 选区即抽 → 看单点质量 + backlink 是否合理。
- RAG 汇总 → 看溯源链接可点。
- Obsidian 图谱是否自动形成网络(标签/backlink)。

---

## 9. 待决策 / 延后

| # | 项 | 何时定 |
|---|---|---|
| D1 | 批处理默认 token/块(3000)、重叠(200);**不设硬上限,抽取前弹窗预估花费确认** | 实现期微调 |
| D2 | Jaccard 去重阈值(0.8) | 实现期调 |
| D3 | 向量语义检索 | Phase 1.5(验证 RAG 真有人用后) |
| D4 | 图谱可视化(搜索定位+高亮、问题→链路高亮) | Phase 2(先测 Obsidian 图谱自由度) |
| D5 | annotation 渲染层重新启用(linkService 接 _layerProperties) | MVP |
| D6 | 英文选区偏移修复 | MVP |
| D7 | Ollama 本地 provider(Phase 1 砍了) | Phase 1 后,若要本地再加 |
| D8(已决)| 注册 `.pdf` 扩展名双击打开(推翻 V1.5 原 D8「不注册」) | Phase 1 必做 |
| D9(已决)| 默认模型 `deepseek-v4-flash`(纯文本;实现期核对真实 ID) | Phase 1 |
| D10(已决)| 模块化 `DocumentSource` 接口,extractor 不绑 PDFViewer | Phase 1 必做 |

---

## 10. 与 spike 代码的衔接

复用(spike `w0-spike` 分支):
- `src/pdf-view.ts`(PDFViewer embed)→ 批处理从 `pdfViewer`/`this.doc` 拿 PDFDocumentProxy;选区从 `onSelectionEnd` 的定位拿 page + selected
- `src/pdf-worker.ts` + `src/pdfjs-version-shim.ts` + esbuild onLoad patch + annotation disable + page-width RO + wheel throttle → 全部保留(spike 12 条集成发现)
- `src/highlight.ts`(`buildAnchor`/`pageTextFromItems`)→ SelectionExtractor 复用 pageTextFromItems 拼 page 文本

新增(spike 之上):
- `src/document-source.ts`(`DocumentSource` 接口 + PDF reader 实现)
- `src/llm-service.ts`(`LLMProvider` 接口 + OpenAI-compatible 实现,覆盖 DeepSeek;默认 deepseek-v4-flash)
- `src/batch-extractor.ts`
- `src/selection-extractor.ts`
- `src/note-generator.ts`
- `src/knowledge-panel.ts`(RAG view)
- `src/settings.ts`(Settings tab + SecretStorage + 费用预估)
- `src/pdf-toolbar.ts`(视图内工具栏:页码/缩放/抽取按钮/暗色)+ 右键菜单 + 选中浮工具栏
- 修改 `src/main.ts`(`registerExtensions(['pdf'])` + view + settings tab + 命令)
- 修改 `src/pdf-view.ts`(实现 `DocumentSource` + `getLeaf` tab 打开 + 工具栏挂载)

---

*下一步:本 spec review 通过后,用 writing-plans 出 Phase 1 实现计划( bite-sized TDD 任务)。*
