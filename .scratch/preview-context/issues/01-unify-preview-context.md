# 01 — 深化:统一「当前预览上下文」为单一重派生模块 PreviewContext

**What to build:** 把 `ShiyueWorkspace` 里四个互相重叠的「当前文件/leaf」真相源(`tracker` PreviewTracker / `activeFile` / `panelCtx` PanelContextTracker / 存储的 `previewLeaf` 引用)合并为一个纯读侧模块 `PreviewContext`,**每次读取从布局结构现派生**{preview-leaf, file, kind},绝不存陈旧 leaf 引用。这消除三轮 bug 的同源(陈旧 `previewLeaf` ref + 多真相源 + `ensureShiyueSplit.setActiveLeaf` 与 `openInShiyue.duplicateLeaf` 的隐式顺序耦合)。

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

## 设计决策(grill-with-docs 已定)

1. **Model B(特定位置)**:「预览上下文」= 右上 split 的 preview leaf,**不是**广义 active leaf。native 开进预览区的笔记触发 file-open → 重派生 → 面板切;主编辑器笔记不抢面板(正确,不在预览)。3b 的 synthesis 链接→openInPreview→开进预览区→面板递归切换,仍工作。
2. **β seam(读/写分立)**:`PreviewContext` = 纯读侧(getPreviewLeaf/getFile/getKind/onChange)。候选 #2(`PreviewSplit` adapter)= 写侧(openInPreview/ensure/toggle,duplicateLeaf/createLeafBySplit 收进)。**#2 本 ticket 不做**——写操作(openInShiyue/ensure/toggle/attachCapture)暂留 ShiyueWorkspace,改读 `PreviewContext.getPreviewLeaf()` 取目标 leaf;#2 后续单独深化。
3. **纯派生(每次读现算)**:`getPreviewLeaf()` 每次调用现走结构(`getLeavesOfType(aiViewType)[0]` → `.parent`(Tabs)→ `.parent`(右栏 Split)→ `.children` → 非-ai 子(preview tab 组)→ 其当前 leaf)。不存 leaf ref → 无陈旧可 staleness。listener diff 缓存「派生结果」(非真相源),每事件覆写。
4. **接口 + 可测纯 seam**:
   ```ts
   interface PreviewContext {
     getPreviewLeaf(): WorkspaceLeaf | null;
     getFile(): TFile | null;
     getKind(): PanelContextKind;          // 复用 panel-context.ts 的 pdf|knowledge-point|none
     onChange(ctx: PreviewCtx): () => void;
   }
   // 纯函数,可注入 fake——新测试 seam
   derivePreviewContext(aiLeaf: WorkspaceLeaf | null, fmOf: (f: TFile) => any): PreviewCtx | null
   ```
   `PreviewContext` 类是不测的 Obsidian 接线壳(4 事件→重走→diff→onChange);`derivePreviewContext` 是纯逻辑,注入 fake aiLeaf/结构 + fmOf 单测(先例:`classifyContext`、`BatchExtractor` 注 mock LLM)。
5. **单一连贯迁移**:建 PreviewContext + derivePreviewContext(单测先绿)→ 一改 ShiyueWorkspace 读侧委托 PreviewContext → 删 tracker/activeFile/panelCtx/previewLeaf 四字段 + PreviewTracker/PanelContextTracker(或吸收其 observer 入 PreviewContext)。写操作暂留 ShiyueWorkspace,读 leaf 改走 `PreviewContext.getPreviewLeaf()`。**不 expand-contract**(局部单文件 ~6 读点,非广爆半径;且过渡期双源会重造正在修的 bug)。

## 退化结构处理
走结构中途(layout-change 在 duplicateLeaf 中途触发)→ 防御 null 检查 → 返 null。调用方优雅降级:面板 none→禁用;抽取→「No PDF open」Notice;openInShiyue→先 ensure()。**无 last-known-good**(纯派生不造假 leaf)。

## Acceptance criteria
- [x] 新模块 `src/workspace/preview-context.ts`:`PreviewContext` 类 + 纯函数 `derivePreviewContext`(走结构找 preview leaf + file + kind,防御 null)。
- [x] `derivePreviewContext` 单测:fake aiLeaf/结构(fake parent/children 链)+ fmOf,覆盖 (a)正常派生 (b)aiLeaf null (c)右栏 split 无非-ai 子 (d)kind 检测(pdf/knowledge-point 遗留 synthwell_type 也认,ADR-Bug4 一致) (e)退化返 null。先例:`panel-context.test.ts`。
- [x] `PreviewContext` 类:4 事件(active-leaf-change + file-open + layout-change + metadataCache.changed)→ `derivePreviewContext` → diff → onChange;`getPreviewLeaf/getFile/getKind` 现派生。
- [x] `ShiyueWorkspace`:删 tracker/activeFile/panelCtx/previewLeaf 四字段;所有读(getCurrentFile/recomputeContext/extractBatch/extractSelection/hasDoc 判定/isPreviewLeafValid/attachPreviewCapture 的 leaf/openInShiyue 的 target)改走 `this.previewCtx.getPreviewLeaf()` 等;panel 的 onContextChange/onFileChange 改委托 previewCtx.onChange。写操作(openInShiyue/ensureShiyueSplit/toggleShiyueSplit/attachPreviewCapture)逻辑留,只改 leaf 来源。
- [x] 删 `preview-tracker.ts`、`panel-context.ts` 的 tracker 类(若吸收 observer 入 PreviewContext)或保留纯 `classifyContext`/`PanelContext` 类型(被 PreviewContext 复用)。判断实现期定。
- [x] `npm run build` clean;`node --test` 全绿(原 150 + derivePreviewContext 新增)。
- [x] 人工验(写侧 Obsidian 耦合):(a)开 PDF #1→#2 上方新 tab(Bug1 不回归);(b)native 双击 PDF 进预览区→浮按钮+抽取可用(Bug1+2 不回归);(c)synthesis 链接→笔记开进预览区(3b 不回归);(d)预览有笔记时 open in shiyue PDF 不新建窗(Bug1-#2 不回归);(e)开知识点笔记→面板切汇总(4 不回归)。

## Out of scope(留 #2)
- `PreviewSplit` 写侧 adapter(openInShiyue/ensure/toggle 的 duplicateLeaf/createLeafBySplit/createLeafInParent 收进小 interface)。#1 只让写操作读 PreviewContext 的 leaf,不抽 adapter。
- 真正消除 `Transport destroyed` console noise(createLeafInParent 替 duplicateLeaf)——#2 评估,不阻塞 #1(#1 仍用 duplicateLeaf)。

## Comments
- 2026-08-02 — grill-with-docs 定 design(5 决策)。源:三轮 bug post-mortem(improve-codebase-architecture 候选 #1,Strong)。三轮各追到四源之一变陈旧/隐式顺序耦合;纯派生 Model B 直接消同源。`derivePreviewContext` 纯 seam 首次让「结构→上下文」映射可单测(此前全 HITL)。
- 2026-08-02 — 实现完成(/implement + /code-review)。新增 `src/workspace/preview-context.ts`(`derivePreviewContext` 纯函数 + `PreviewContext` 接线壳)+ `.test.ts`(16 用例覆盖 (a)-(e) + currentTab 边界);`ShiyueWorkspace` 删 4 字段(tracker/activeFile/panelCtx/previewLeaf)+ 僵尸 `aiLeaf` 字段,所有读委托 `previewCtx`,写操作逻辑留只换 leaf 来源;删 `preview-tracker.ts`(+test)、`PanelContextTracker` 类,留 `classifyContext`/`PanelContext` 类型。`npm run build` clean;`node --test` 161/161 绿(150 − 5 PreviewTracker + 16 derivePreviewContext)。code-review Spec 发现 `metadataCache.changed` 守卫用 `last?.file`(缓存)有顺序耦合风险 → 改无条件 recompute(靠 diff 去噪)。写侧 Obsidian 耦合(5 项回归)待人工验 → status ready-for-human。
- 2026-08-02 — **人工验通过**(用户确认):5 项写侧回归全绿——Bug1(PDF #1→#2 上方新 tab)、Bug1+2(native 双击 PDF 进预览区→浮按钮+抽取)、3b(synthesis 链接→笔记开预览区)、Bug1-#2(预览有笔记时 open in shiyue PDF 不新建窗)、4(开知识点笔记→面板切汇总)均不回归。#01 完结。下一步:#2(PreviewSplit 写侧 adapter + createLeafInParent 替 duplicateLeaf 消 Transport destroyed console noise)——未立项。
