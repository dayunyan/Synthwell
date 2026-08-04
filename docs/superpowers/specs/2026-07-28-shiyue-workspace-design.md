# 拾阅 / Shiyue — 工作区 v1 设计:原生 viewer + 图谱中枢 + AI 面板

> **日期**:2026-07-28
> **状态**:设计完成,待 review
> **前置**:产品 spec(2026-07-23)、spike 结果与重定位(2026-07-27)、Phase 1 Plan 2(批处理抽取,已验)、原生 PDF viewer 开放度调研(2026-07-28)
> **范围**:本设计定义「拾阅工作区 v1」——以 Obsidian 原生图谱为中枢,点 logo 在右侧分出「原生 PDF 预览 + 拾阅 AI 面板」两屏,右键文件列表「在拾阅中打开」加载文件,AI 面板按钮(批/选区抽取)对预览文件操作。同时定义**模块化目录结构**为后续 Agent 打地基。
> **取代**:Phase 1 Plan 3 的「劫持 .pdf 双击 + 自 embed viewer + 右键菜单触发」方向(退役 embed,改原生 viewer;触发改 AI 面板按钮 + 预览右键共存)。

---

## 0. 目标与边界

**一句话**:用户装插件配好 AI → 打开工作目录 → Cmd+G 开图谱 → 图谱右上角拾阅 logo → 点 → 右侧分两屏(上原生 PDF 预览 / 下 AI 面板)→ 右键文件列表「在拾阅中打开」加载文件 → AI 面板「抽取整篇知识点」「选区知识点提取」对预览文件操作 → 知识点笔记入库、图谱自动浮现新节点。

**MVP 第一刀(本设计)**:
- 图谱中枢 + logo 注入(被动 DOM)
- logo 触发右侧分屏(原生 PDF 预览上 + 拾阅 AI 面板下)
- file-list 右键「在拾阅中打开」(公开 `file-menu` 事件)
- AI 面板两按钮(抽取整篇 / 选区知识点提取)对预览文件操作
- 选区提取两种触发共存:AI 面板按钮 + 预览内右键「深抽这个知识点」
- 按钮在预览无文件时禁用

**延后**:
- 图谱节点右键「在拾阅中打开」(**无公开 hook**;要做得 monkey-patch 图谱 view,v1 不做——见 §7)
- 聊天输入框 + AI Agent 自然语言操作工作区(复杂度最高,单独立项)
- 高亮 overlay(PDF++ 领域;DOM overlay 或推荐用户装 PDF++)
- 向量语义检索(Phase 1.5)

---

## 1. 架构

### 布局(点 logo 后)

```
┌───────────────────────┬───────────────────┐
│                       │  文件预览(原生 PDF) │ 上 leaf  viewType='pdf'
│   原生 graph view      ├───────────────────┤
│   (Cmd+G,左 leaf)      │  拾阅 AI 面板      │ 下 leaf  viewType='shiyue-ai-panel'
│                  [📖]  │  [抽取整篇][选区提取]│
│                       │  (聊天框 留位)     │
└───────────────────────┴───────────────────┘
        logo 被动注入到 graph view 的 contentEl 右上角
```

### 组件(全是公开 API,零 monkey-patch)

| 组件 | 职责 | API |
|---|---|---|
| Logo 注入器 | 给当前 graph view 的 contentEl 右上角 DOM 注入 📖 按钮;点击 → ensureShiyueSplit | `getLeavesOfType('graph')`→`view.contentEl`(被动 DOM,不 patch 图谱内部) |
| `ensureShiyueSplit()` | 右侧分屏:上 leaf 放原生 PDF view、下 leaf 放 `shiyue-ai-panel`;已存在则聚焦 | `getLeaf('split','right')` + vertical split(公开 layout API) |
| `openInShiyue(file)` | 确保 split + 用原生 PDF view 在上 leaf 打开 file + AI 面板跟踪 | `leaf.openFile(file)`(走原生 'pdf' 路由) |
| `shiyue-ai-panel` view | 两个按钮 + 聊天留位;跟踪预览 leaf 的 file → 启用/禁用按钮 | 自定义 `ItemView` |
| file-menu hook | 给 `.pdf` 文件加「在拾阅中打开」→ `openInShiyue(file)` | `app.workspace.on('file-menu', ...)`(obsidian.d.ts L8109,公开) |
| 选区捕获 | 给上屏预览 leaf 的 contentEl 挂 `mouseup` → 缓存 {text, page};预览右键「深抽」 | `registerDomEvent`(被动) + `window.getSelection()` + `.page[data-page-number]` 祖先(复用 spike `onSelectionEnd` 逻辑,挂到原生 viewer DOM) |
| 批处理抽取 | 「抽取整篇」按钮 → `BatchExtractor.extract(PdfDocumentSource(file))` | 复用 Plan 2(`PdfDocumentSource` file 级重读,不碰原生 view 内部 doc) |
| 选区抽取 | 「选区知识点提取」按钮 / 预览右键 → `SelectionExtractor.extract`,上下文 ±2 页从 `PdfDocumentSource(file).getDocument()` 拿 | 复用 Plan 3 Task 1;选区从选区捕获缓存拿;上下文 file 级重读(公开) |

### 数据流

1. 右键文件列表 `.pdf` → file-menu「在拾阅中打开」→ `openInShiyue(file)` → 上 leaf 原生预览打开 + AI 面板跟踪 file → 按钮启用。
2. 「抽取整篇」→ `BatchExtractor.extract` 取文本/分块/预估确认/map 去重/生成笔记 → 写 `拾阅笔记/知识点/{书名}/` → 图谱自动浮现新节点。
3. 选中文字(mouseup 缓存 {text,page})→ 「选区知识点提取」(或预览右键)→ `SelectionExtractor.extract` 单点深抽 → 生成 `extraction_mode: selection` 笔记 + 打开。

---

## 2. 模块化目录结构(为 Agent 打地基)

**原则**:`core/` 纯逻辑可单测、尽量不耦合 obsidian;`workspace/`+`preview/` 耦合 obsidian 但被动(不 patch 内部);`main.ts` 仅装配。**未来 Agent**(`core/agent/`,本设计不建)将把 `workspace/` + `core/extraction/` 的函数包装成 tool 调用——边界清晰才好包装。

```
src/
  main.ts                        # 插件入口:onload 仅装配(settings + workspace + file-menu + 命令)
  settings.ts                    # ShiyueSettings + DEFAULT_SETTINGS
  settings-tab.ts                # 设置面板 UI
  core/                          # 框架层:纯逻辑,可单测
    llm/
      llm-service.ts             # LLMProvider + OpenAICompatibleProvider
      llm-json.ts                # parseLLMJson
      usage.ts                   # estimateTokens/estimateCost/monthKey + UsageTracker
    extraction/
      batch-extractor.ts         # chunkPages/jaccard/dedupe/extractChunk/extract + ExtractionState
      selection-extractor.ts     # SelectionExtractor
      note-generator.ts          # KnowledgePoint/renderNote/sanitizeTitle/NoteGenerator
      normalize.ts               # normalizePoint(batch 用,从 batch-extractor 抽出;selection-extractor 保留自己的 normalizeSelectionPoint,因 related 是 {title,reason}[] 与 batch 的 string[] 不同)
      extraction-state.ts        # per-PDF 状态
    document/
      document-source.ts         # DocumentSource 接口 + PdfDocumentSource(file 级重读)
      pdf-text.ts                # pageTextFromItems + buildAnchor/resolveAnchor(从 highlight.ts 迁;选区锚定为未来高亮 overlay 留)
    fs/
      vault-fs.ts                # ensureFolder/dirOf
  preview/
    selection-capture.ts         # attachSelectionCapture(leaf):DOM mouseup→缓存 {text,page};被动
  workspace/
    shiyue-workspace.ts          # ensureSplit/openInShiyue/logo 注入(graph contentEl)
    ai-panel-view.ts             # shiyue-ai-panel ItemView(按钮 + 聊天留位)
    preview-tracker.ts           # 跟踪预览 leaf 的 file→按钮启用/禁用
    file-menu.ts                 # file-menu hook「在拾阅中打开」
  ui/
    confirm-modal.ts             # confirmCost Modal(批处理预估弹窗,复用)
```

**退役(删)**:`pdf-view.ts`(spike embed)、`pdf-worker.ts`、`pdfjs-version-shim.ts`、esbuild 的 `copyPdfWorker`/`patchPdfViewerVersionCheck`/`scope-pdfjs-css`、styles.css 的 `.shiyue-pdf-root` 作用域——原生 viewer 不需要这些。

**迁移**:现有 `src/*.ts` 的纯逻辑文件按上表移入 `core/` 对应子目录(机械移动 + 改 import 路径 + 验测试绿)。`highlight.ts` → 拆:`pageTextFromItems`/`buildAnchor`/`resolveAnchor` 进 `core/document/pdf-text.ts`。

---

## 3. 选区两种触发(共存)

- **AI 面板按钮**「选区知识点提取」:读选区捕获缓存;无缓存则禁用 + Notice「先选中一段」。
- **预览内右键**「深抽这个知识点」:挂在预览 leaf 的 contentEl `contextmenu`;有选区才出该菜单项,调同一 `extractSelection(file, sel)`。
- 两者共用 `SelectionExtractor` + 同一上下文组装(file 级 ±2 页 + 已有标题)。

---

## 4. 复用 / 退役

| | 处置 |
|---|---|
| Plan 2 批处理逻辑(BatchExtractor / NoteGenerator / parseLLMJson / ExtractionState / vault-fs) | **复用**——「抽取整篇」按钮调 |
| Plan 3 Task 1-2(SelectionExtractor 逻辑 + NoteGenerator related_reasons 渲染) | **复用**——「选区提取」按钮/右键调 |
| Plan 3 Task 3-5(我们的 PdfView.getSelection/getDocument、右键菜单、extractSelection 绑我们的 view) | **替换**——embed 退役;选区从原生预览 DOM 拿;触发改 AI 面板按钮 + 预览右键 |
| spike PdfView embed(PDFViewer 那套) | **退役**;spike 选区捕获**逻辑**迁移到原生 DOM |
| `PdfDocumentSource`(file 级重读) | **复用**——批处理 + 选区上下文都用它 |

---

## 5. 技术假设(实现期第一步先验)

**原生 PDF view 的 DOM 含 `.page[data-page-number]`**(pdfjs 标准;PDF++ 证实原生 viewer 是 pdfjs)——选区页码定位靠它。若不成立,选区页码改解析原生引用链接 `#page=N&selection=a,b,c,d` 的 `page` 段(选区文本仍从 `window.getSelection()` 拿)。**Plan B 第一步先在测试 vault console 里验这个 DOM 选择器**。

---

## 6. 实现排序

- **Plan A — 重构地基**(先做):把现有纯逻辑机械迁入 §2 的 `core/` 模块化布局,改 import,验 37/37 测试绿。**保留** spike embed + main.ts 现有装配(插件仍可用)。低风险(tsc + 测试把关),产出干净地基。
- **Plan B — 建工作区**:删 spike embed + 其 build 管线;建 `preview/`+`workspace/`+`ui/`;logo/分屏/AI 面板/file-menu/选区捕获/抽取接线;选区两种触发。人工验(原生预览 + 选区 + 批/选区抽)。

A→B:Plan A 不破坏插件(只是搬文件),Plan B 在干净结构上建新功能、退役老 embed。

---

## 7. 延后 / 未来

- **图谱节点右键**:无公开 hook(`obsidian.d.ts` 只有 `file-menu`)。要做得 monkey-patch 图谱 view(脆,同 PDF++ 风险)。替代:点节点正常打开笔记/文件,再 file-list 右键或「发送到拾阅」命令。
- **聊天 Agent**:本设计留 `shiyue-ai-panel` 聊天框 UI 留位,逻辑单独立项。Agent 将把 `workspace/`(openInShiyue 等)+ `core/extraction/`(extractBatch/extractSelection)的函数包装成 tool,LLM 调用——§2 的边界就是为这打的。
- **高亮 overlay**:PDF++ 领域;未来 DOM overlay(用 `core/document/pdf-text.ts` 的 buildAnchor)或推荐用户装 PDF++。
- **向量语义检索**:Phase 1.5。

---

## 8. 测试策略

- **可单测(`core/`,不依赖真 obsidian/AI)**:现有 50 测试覆盖批/选区抽取 + 锚定 + 设置/用量/llm/document-source;Plan A 迁移后保持绿;`SelectionExtractor` 两种触发共用同一逻辑(只加 UI 触发,不加逻辑)。
- **人工验(`workspace/`+`preview/`)**:原生预览打开、选区两种触发、批/选区抽、图谱节点浮现、§5 的 DOM 假设。

---

## 9. 与已有 spec/plan 的关系

- 本设计**取代** Phase 1 Plan 3 的方向(embed + 劫持 + 右键菜单触发),改原生 viewer + AI 面板按钮/预览右键触发。
- Plan 2(批处理)逻辑**复用**;Plan 3 Task 1-2(选区抽取纯逻辑)**复用**。
- 原 Phase 1 §1.1 的「视图内工具栏 / 浮起迷你工具栏」**并入** AI 面板(按钮在 AI 面板而非 PDF 视图内,更契合工作区设想)。

*下一步:本 spec review 通过后,用 writing-plans 出 Plan A(重构地基)+ Plan B(建工作区)。*
