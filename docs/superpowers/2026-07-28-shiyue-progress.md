# 拾阅 / Shiyue — 工作进度(告一段落)

> **日期**:2026-07-28
> **状态**:工作区 v1 代码完成(Plan A→B→C + round-2 fixes)。`npm run build` clean,`node --test` 78/78 绿。**4 个交互 bug 待修**(见 §5)。下一阶段:先修这 4 个(§5),再做 i18n + Agent(§6)。

---

## 1. 项目一句话

拾阅 = Obsidian 插件,从 PDF 抽取知识点笔记。以 Obsidian 原生图谱为中枢:点图谱右上角拾阅 logo → 右侧分两屏(上原生 PDF 预览 / 下拾阅 AI 面板)→ 右键文件列表 `.pdf`「在拾阅中打开」加载文件 → AI 面板「抽取整篇知识点」「选区知识点提取」对预览文件操作 → 知识点笔记入 `拾阅笔记/` + 图谱浮现新节点。全公开 API,零 monkey-patch。

## 2. 架构(当前文件树)

```
src/
  main.ts                      # 装配层:settings + workspace + file-menu + 命令(无逻辑)
  settings.ts / settings-tab.ts / settings.test.ts
  core/                        # 纯逻辑,可单测(不耦合真 obsidian/AI)
    llm/        llm-service, llm-json, usage + tests        # OpenAI 兼容 provider + parseLLMJson + 估算/记账
    extraction/ batch-extractor, selection-extractor, note-generator, extraction-state, normalize + tests
                # chunkPages/jaccard/dedupe/extractChunk/extract + SelectionExtractor + 笔记渲染 + 状态 + tag 清洗
    document/   document-source, pdf-text, pdf-worker-config + tests
                # PdfDocumentSource(file 级重读) + pageTextFromItems/buildAnchor + configureWorker(从 spike 迁入)
    fs/         vault-fs                                  # ensureFolder/dirOf
  preview/
    selection-cache.ts(.test)   # 纯 SelectionCache(node:test 可加载,无 obsidian)
    selection-capture.ts        # attachSelectionCapture(mouseup→cache + contextmenu capture→深抽 Menu)+ findPageNumber
  workspace/                    # 耦合 obsidian(被动,不 patch 内部)
    shiyue-workspace.ts         # ensureShiyueSplit / openInShiyue / openInShiyuePicker / injectLogo / PanelActions
    ai-panel-view.ts            # shiyue-ai-panel ItemView:两按钮 + 聊天留位,按文件启用/禁用
    preview-tracker.ts(.test)  # PreviewTracker:持 currentFile + onChange 通知
    extraction-controller.ts    # extractBatch/extractSelection 胶水(build provider/noteGen/state + LoadingNotice + AbortController)
    file-menu.ts                # workspace.on('file-menu') 给 .pdf 加「在拾阅中打开」
  ui/
    confirm-modal.ts           # confirmCost Modal(批处理预估弹窗)
    loading-notice.ts           # 持续 Notice(spinner + 文本 + Stop)
esbuild.config.mjs              # cjs bundle;copyPdfWorker 插件(保留);patchPdfViewerVersionCheck 已删(spike 退役)
styles.css                      # 小(24 行):confirm-btns + ai-panel + logo + spinner(spike 6872 行作用域 CSS 已删)
```

**退役(spike embed)**:`pdf-view.ts` / `pdf-worker.ts` / `pdfjs-version-shim.ts` / `scripts/scope-pdfjs-css.mjs` 已删。`configureWorker` 移到 `core/document/pdf-worker-config.ts`(文件级重读仍需)。

## 3. 已完成(按顺序)

| 阶段 | 内容 | 测试 |
|---|---|---|
| **Plan A** | `src/*.ts` 纯逻辑机械迁入 `core/{llm,extraction,document,fs}/` 模块化布局,改 import。保留 spike embed。 | 50→50 |
| **Plan B** | 建工作区:logo 注入 + 右侧分屏(原生预览上 + AI 面板下)+ file-menu「在拾阅中打开」+ 选区捕获(mouseup→cache)+ 抽取接线(batch=PdfDocumentSource file 级重读;selection=±2 页上下文)+ 退役 spike embed + 其 build 管线 + nuke styles.css。 | →59 |
| **Plan C**(9 项人工验反馈) | #9 tag 清洗(`sanitizeTag`/`splitTag` 在 normalize 边界,空格→_、去#/标点 → frontmatter 不再划线)+ #6 长文档分块重写(10k token/块上限 + 长文(>10k)且自然<3 时降 budget 强制≥3 + `doc.getOutline()` 章节对齐 + 每块≥1 保底:prompt 加强 → 0 点重试 `forceAtLeastOne` → 仍 0 则 `synthesizePoint` 兜底)+ #5/#8 `LoadingNotice`(持续 spinner + Stop)+ `AbortController` 贯穿 batch/selection + #4 `onConfirmed` 在点「继续」后才显 notice + #2 logo 注入 `.view-actions`(头栏「...」之左)+ #3 openInShiyue 空→替换/有文档→同 split 新 tab + #7 contextmenu capture 阶段。 | →78 |
| **round-2 fixes** | SelectionCache 拆纯模块 + `selection-capture.ts` 静态 `import { Menu }`(修右键「深抽」菜单不出现——动态 `await import("obsidian")` 运行时抛 "Failed to resolve module specifier")+ `createLeafInParent`(同 split 新 tab,**未生效**,见 Bug 3)+ `layout-change` 清 tracker(preview 关后按钮禁用)+ `onProgress` 移到循环顶部 + `onConfirmed(total)`(显 x/t 进度)。 | 78 |

**验证过的(可用)**:批处理抽取端到端(4 页→5 点,Plan 2 时期)、tag 清洗、每块≥1 兜底(console 见「兜底合成 1 点」)、LoadingNotice spinner + Stop 取消(console 见 abort 触发)、10k 分块(77 页→18 块)、contextmenu capture 触发我们的菜单。

## 4. 当前状态

- **build**:`npm run build` clean(tsc -noEmit -skipLibCheck + esbuild)。
- **测试**:`node --test --experimental-strip-types $(find src -name '*.test.ts')` → 78 pass / 0 fail。
- **分支**:`w0-spike`(从 spike 阶段沿用至今)。
- **手动验**:测试 vault(`test-vault/`)重载插件 → 跑图谱 + 右键 + 抽取流程。

## 5. 待修 bug(4 个,本轮人工验发现)

### Bug 1:logo 再次点击应收起右侧两屏(现:split 新预览窗)
- **现象**:点 logo 第一次开 split;第二次点击又 split 一个新预览窗(而非收起)。
- **期望**:第二次点击 = **收起**(toggle)右侧两屏;第三次 = 再开。
- **根因**:① `ensureShiyueSplit` 只 "ensure exists",**无 toggle**;② `isPreviewLeafValid` 用 `getLeavesOfType('pdf').includes(ref)`,对**空**预览 leaf(刚建、无文件,非 'pdf' 类型)返回 **false** → 每次点都走 "recreate preview" 分支 → `createLeafBySplit(ai,'horizontal',true)` 堆叠新 leaf。
- **修法**:① logo onclick 改 toggle(split 已存在则 detach/隐藏右栏,否则 ensure);② `isPreviewLeafValid` 改用 leaf **存活**检查(`this.previewLeaf?.containerEl?.isConnected`)而非 'pdf' 类型包含(空 leaf 也算有效)。

### Bug 3:「在拾阅中打开」仍 split 新预览窗(**与 Bug 1 同根因**)
- **现象**:右键 `.pdf`「在拾阅中打开」仍开新预览窗,控制台**无报错**。
- **根因**:同 Bug 1 ② —— `ensureShiyueSplit` 的 "ai exists" 分支里 `isPreviewLeafValid` 对空/刚建预览返回 false → `createLeafBySplit` 建新 leaf → `openFile` 在新 leaf 上 → 看起来像「新窗口」。round-2 的 `createLeafInParent` 改动只动 has-doc 新 tab 路径,**没动这个 recreate 路径**,所以没修好。
- **修法**:同 Bug 1 ② —— `isPreviewLeafValid` 改 `containerEl.isConnected` 存活检查。改后:首次开(空 leaf 存活)→ valid → 不 recreate → `openFile` 替换;有文档再开 → has-doc → `createLeafInParent` 新 tab(若 createLeafInParent 仍不生效,见 §7 关键事实,换 `duplicateLeaf` 或别法)。
- **优先**:Bug 1 + Bug 3 同根因,**一起修**(改 `isPreviewLeafValid` + logo toggle)。

### Bug 2:措辞 + i18n
- **现象**:「抽取」「深抽」等措辞不好;所有文字应**跟随系统语言**。
- **范围**:所有 user-facing 字符串(按钮、菜单项、Notice、命令名、设置面板)→ 抽到 locale map(至少 zh-CN + en);检测系统语言(`window.moment?.locale()` / `navigator.language`)。
- **涉及文件**:`workspace/ai-panel-view.ts`(按钮)、`preview/selection-capture.ts`(右键菜单项)、`workspace/shiyue-workspace.ts`(命令名)、`workspace/extraction-controller.ts`(Notice)、`workspace/file-menu.ts`(菜单项)、`settings-tab.ts`、`ui/loading-notice.ts`(label)。LLM prompt 是否随语言改另议(prompt 是给模型的中英混合指令,改语言可能影响质量)。
- **规模**:非平凡 refactor,**单独立项**(建议命名 Plan D: i18n + 措辞)。措辞建议:「抽取整篇知识点」→「提炼全书要点」;「深抽这个知识点」→「深读这一段」或「精读选中」;「选区知识点提取」→「提炼选中要点」;具体待用户定。

### Bug 4:右键「深抽」吃掉了原生菜单(复制成链接等)
- **现象**:预览选中文字右键,「深抽这个知识点」出现了,但 Obsidian 原生的「复制成链接」「复制为引用」等**没了**。
- **根因**:`onContextMenu` 里 `ev.preventDefault(); ev.stopPropagation()` 压制了原生菜单,只显我们的 Menu。
- **期望**:我们的项 + 原生项**共存**。
- **难点**:原生 PDF viewer 的 context menu **不经公开 API 暴露**(公开的 `workspace.on('file-menu')` 只管文件列表,不管 viewer 内选区)。不加 monkey-patch 的共存方案有限:
  - **(a) 选区浮按钮**(推荐):不 preventDefault,让原生菜单照常出;另在 mouseup 选区附近浮一个「深读」按钮(hover toolbar 式,定位用 `window.getSelection().getRangeAt(0).getBoundingClientRect()`)。不劫持菜单。
  - (b) monkey-patch 原生 viewer 的 contextmenu handler(PDF++ 风格,脆,spec §7 明确延后)。
  - (c) 在原生菜单后追加我们的菜单(两菜单,丑)。
- **建议**:走 (a)。需小设计(浮按钮定位 + 消失时机 + 与 LoadingNotice 协同)。

## 6. 已知限制 / 延后(spec §7)

- **图谱节点右键「在拾阅中打开」**:无公开 hook(`obsidian.d.ts` 只有 `file-menu`)。要 monkey-patch 图谱 view,v1 不做。替代:点节点正常打开,再 file-list 右键或命令。
- **聊天 Agent + 自然语言操作工作区**:`shiyue-ai-panel` 留了聊天框 UI 留位,逻辑单独立项。Agent 将把 `workspace/`(openInShiyue 等)+ `core/extraction/`(extractBatch/extractSelection)函数包装成 tool,LLM 调用——§2 的模块化边界就是为这打的。
- **高亮 overlay**:PDF++ 领域;未来 DOM overlay(用 `core/document/pdf-text.ts` 的 buildAnchor)或推荐用户装 PDF++。
- **向量语义检索**:Phase 1.5。
- **`app.secretStorage.getSecret` 同步用法**:`main.ts`/`extraction-controller.ts` 现用法 `this.app.secretStorage.getSecret("shiyue-api-key") ?? ""`(同步取值,Plan 2 验证可工作)。若实际返回 Promise 则是 pre-existing latent bug,未修(超范围)。若未来 API key 不生效,先查这。

## 7. 关键 API 事实(实现期踩坑,备忘——别重踩)

1. **Obsidian 分屏方向反直觉**:`getLeaf('split','vertical')` → 新 leaf 在**右边**;`'horizontal'` → 在**下边**(doc 原话)。
2. **`getLeaf(true)` 开新 tab 落在「主根 split」**,不在 active leaf 的 split(文档:"preferred location within the root split")。→ Bug 3 round-2 用 `createLeafInParent` 替代。
3. **`Workspace.getLeaves()` 本版本不存在**,只有 `getLeavesOfType(viewType)`。→ leaf 存活检查用 `containerEl.isConnected`,不用 getLeaves。
4. **`createLeafInParent(parent: WorkspaceSplit, index)`** 的 .d.ts 窄标 `WorkspaceSplit`,但 `leaf.parent` 是 `WorkspaceTabs`(extends `WorkspaceParent`,非 `WorkspaceSplit`)→ cast 绕过 tsc;**但实测 createLeafInParent 仍 split 新窗(未生效,Bug 3)**,可能要换 `duplicateLeaf(leaf, 'tab')` 或 `leaf.parent.children` 手动 push。需再试。
5. **`setActiveLeaf(leaf, { focus })`** 是现代重载(对象参);旧 `setActiveLeaf(leaf, pushHistory, focus)` 已 deprecated。
6. **`Notice` 构造收 `string | DocumentFragment`**(不收 HTMLElement)→ 自定义 DOM 要包 `document.createDocumentFragment()` 再 `appendChild`;`new Notice(el, 0)` = 持续(0 不自动隐);有 `setMessage`/`hide`。
7. **`obsidian` 包 `main:""`(纯类型)** → **不能**运行时 `import("obsidian")`(抛 "Failed to resolve module specifier 'obsidian'")。**静态** `import { X } from "obsidian"` 由 esbuild bundle 成 `require('obsidian')`,运行时 OK。→ 凡用 obsidian 运行时 API 的模块**不能**被 node:test 加载 → 纯逻辑(如 `SelectionCache`、`PreviewTracker`)要拆到独立模块,测试只引纯模块。
8. **`ChatOpts.signal` 已存在**,`OpenAICompatibleProvider.chat` 已把 `o.signal ?? this.controller.signal` 透传 fetch(llm-service.ts:5,38)→ 取消只需 `AbortController` 贯穿 `BatchExtractor.extract`/`SelectionExtractor.extract` → `extractChunk` → `llm.chat({signal})`,provider 层零改动。
9. **pdfjs `doc.getOutline()`** 取章节边界;`chapterBoundaries(doc)` best-effort 解析(dest 数组首元素 → `doc.getPageIndex(ref)` +1)。两测试 PDF(wanan0614.pdf / A Survey...pdf)无 outline → 回退纯页对齐(正常,非 bug)。
10. **Obsidian 标签规则**:`#` + 1-250 字符,禁空格/`#`/`|`,CJK 允许。LLM 出的 tag 常带空格/标点 → frontmatter 非法 → 划线。`sanitizeTag`(normalize.ts)处理。
11. **chunkPages 签名**:`(pages, budgetTokens, _overlap=0, chapters: number[]=[], longDocThreshold=10000)`——保持向后兼容(3 参测试仍绿)。extract 默认 budget=10000(原 3000 太细)。
12. **每块≥1 保底放 `extract()` 不放 `extractChunk`**——`extractChunk` 仍返回 LLM 给的(0 就 0);`extract` 在 0 后重试 `forceAtLeastOne` → 仍 0 则 `synthesizePoint`。这样 `extractChunk` 契约/测试不破。
13. **styles.css** 原 6872 行全是 spike 的 `.shiyue-pdf-root` 作用域 pdfjs CSS(由 `scripts/scope-pdfjs-css.mjs` 生成)。原生 viewer 自带 CSS → 全删,重写 24 行。`scope-pdfjs-css.mjs` 已删。

## 8. 如何恢复工作

1. `cd /Users/xujunda/Developer/Synthwell`;确认在 `w0-spike` 分支(`git branch --show-current`)。
2. `npm run build` + `node --test --experimental-strip-types $(find src -name '*.test.ts')` 确认 78 绿。
3. 测试 vault 重载插件:Obsidian 设置 → 第三方插件 → 关再开 shiyue;或删 `test-vault/.obsidian/plugins/shiyue/main.js` 再 `npm run build`。
4. **修复优先级**:Bug 1 + Bug 3(同根因,改 `isPreviewLeafValid` 用 `containerEl.isConnected` + logo toggle)→ Bug 4(选区浮按钮,小设计)→ Bug 2(i18n,大改,单独立项 Plan D)。
5. 相关文档:
   - 设计 spec:`docs/superpowers/specs/2026-07-28-shiyue-workspace-design.md`
   - Plan A:`docs/superpowers/plans/2026-07-28-plan-a-restructure.md`
   - Plan B:`docs/superpowers/plans/2026-07-28-plan-b-workspace.md`
   - Plan C:`docs/superpowers/plans/2026-07-28-plan-c-polish.md`
   - 本进度:`docs/superpowers/2026-07-28-shiyue-progress.md`(本文件)
6. 工作流:brainstorming → writing-plans → subagent-driven-development(纯逻辑 task 给 subagent + 两阶段 review;obsidian 耦合 task inline + 人工验)。Plan C 用了这个流程,可复用。

## 9. 提交链(近 16 条,`w0-spike`)

```
6d74b10 fix(shiyue): round-2 — same-split new tab (#1), clear tracker on preview close (#2), onProgress x/t (#4)
ebbefe7 fix(shiyue): split SelectionCache to pure module + static Menu import (#3)
334a13a fix(shiyue): contextmenu capture-phase (native viewer stopPropagation bypass) (#7 plan-c task9)
2a6bbdd fix(shiyue): logo into .view-actions (#2) + openInShiyue same-split new tab (#3) (plan-c task7+8)
749e58e feat(shiyue): ExtractionController wires AbortController+LoadingNotice, onConfirmed gate (#4 #5 #8 plan-c task6)
83f2c1b feat(shiyue): ui/loading-notice (persistent spinner+stop) + spinner styles (#5 #8 plan-c task5)
46fa1a1 feat(shiyue): SelectionExtractor.extract accepts abort signal (#8 plan-c task4)
452dafc feat(shiyue): extractChunk opts(force/signal) + per-chunk>=1 floor + cancel threading (#6 #5 plan-c task3)
06ffa5e feat(shiyue): chunkPages 10k+long-doc>=3+chapter-align + synthesizePoint fallback (#6 plan-c task2)
30f5b4e fix(shiyue): sanitize tags at normalize boundary (#9 plan-c task1)
10a6485 docs(shiyue): plan C — workspace polish + extraction robustness (9 manual-verify findings)
d8a4b08 chore(shiyue): retire spike embed (delete pdf-view/pdf-worker/pdfjs-version-shim/scope-css + esbuild patch + nuke styles) (plan-b task10)
6351bf9 refactor(shiyue): rewire main.ts to workspace assembly (drop spike PdfView usage) (plan-b task9)
17c4cc6 feat(shiyue): workspace/file-menu (在拾阅中打开 hook) (plan-b task8)
8a67a81 feat(shiyue): workspace/ai-panel-view (AiPanelView ItemView + buttons + chat placeholder) (plan-b task7)
79bea57 feat(shiyue): workspace/shiyue-workspace (ensureSplit + openInShiyue + logo + picker) (plan-b task6)
```

---

*告一段落。下次从 §8 恢复,先修 §5 Bug 1+3(同根因),再 Bug 4,再 Bug 2(i18n)。*
