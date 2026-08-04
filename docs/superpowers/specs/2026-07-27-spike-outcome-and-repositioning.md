# 拾阅 / Shiyue — Spike 结果与战略重定位

> **日期**:2026-07-27
> **状态**:W0 spike 完成(技术可行性证实)+ 战略重定位(阅读器降为基础设施,AI 抽取 + 知识图谱升为核心)
> **前置**:产品 spec(2026-07-23)、W0 spike 计划(2026-07-23)
> **本文档**:记录 spike 全部集成发现(避免丢失)+ 用户实测反馈 + 战略转向 + 分阶段计划。作为 MVP 设计的事实基础。

---

## 1. Spike 结论:能不能做

| 闸门 | 结果 | 依据 |
|---|---|---|
| E1 Worker | ✅ 通过 | pdfjs v5.4.530 + `app://` worker URL,Obsidian 的 `app://` origin 下真起子线程 |
| E2 大 PDF + 虚拟滚动 | ✅ 通过 | PDFViewer 自带虚拟化,800 页丝滑 |
| E3 内存回收 | ✅ 通过 | 关 view 后内存回基线(Annotator #233 不释放的病没有) |
| E4 CJK 选区 | ✅ 通过(CJK 完美) | v5.4.530 含 #20334 修复,中文选区准;英文轻微偏移(per-font 度量,小 wart) |
| E5 学曲线 | ✅ 通过 | 前端熟 + 无 Obsidian 经验,全程驱动 |
| E6 真实用户 | ⚠️ 平均 ~2.2/5(低于 3.5 Go 线) | 3 位非社交圈用户;开发者决定不允许 No-Go,转为「修复所有问题」 |
| E7 时间约束 | ✅ 可执行 | 全程未破 |

**技术可行性证实**:PDF 阅读器在 Obsidian 里可做。spec 原担心「PDF 有硬天花板」被实证推翻。

**但 E6 揭示**:阅读器本身不是用户价值——3/3 用户说「单纯阅读器+高亮不付费,免费替代太多」;愿付费的是 AI 深度问答 + 跨文献关联 + 高亮→结构化笔记。这直接触发了战略重定位。

---

## 2. pdfjs-in-Obsidian 集成发现(MVP 硬约束,不可丢)

spike 踩出的一串 pdfjs v5 + Obsidian Electron 集成坑,每条都是 MVP 必须带的(否则重踩):

| # | 发现 | 解法(commit) |
|---|---|---|
| 1 | **pdfjs v5.4.530 是引擎天花板** — v5.5+/v6 用 `Map.prototype.getOrInsertComputed`,Obsidian Electron 没有 | 钉定 v5.4.530,升级即重测 |
| 2 | **Obsidian 内置 pdfjs 5.3.34 污染 `globalThis.pdfjsLib`** — pdf_viewer.mjs 从全局读 version,和我们的 5.4.530 对不上 | `pdfjs-version-shim.ts`(import 首位,重断言全局) |
| 3 | **PDFViewer 构造器版本检查硬抛错** — shim 挡不住动态读 | esbuild `onLoad` patch 把版本检查 neutralize 掉(改 bundle,不碰 node_modules,重装不丢) |
| 4 | **`AnnotationEditorUIManager` 构造时 eventBus 到达 null** | `annotationEditorMode: DISABLE(-1)` 跳过编辑器构造 |
| 5 | **annotation 渲染层 linkService 接线在 v5 有坑** — `addLinkAttributes`/`getDestinationHash` undefined,每次渲染抛错,搅断 textLayer | `annotationMode: DISABLE(0)` 跳过 annotation 渲染层(MVP 再把 linkService 接进 `_layerProperties` 重新启用链接/表单) |
| 6 | **`onePageRendered` 是 getter 返回裸 Promise**(`pdf_viewer.mjs` 7927),不是 `{promise}` | 直接 `.then`,null 守卫 |
| 7 | **page-width 自动适应** — pdfjs 自带 ResizeObserver 不重算 `currentScaleValue` 的特殊值 → 容器从 ~168px(leaf 没布局)长到真实宽度时 canvas 被拉伸 → 模糊 | 自己挂 `ResizeObserver` 在容器宽度变化时 re-set `currentScaleValue="page-width"`(debounce 150ms) |
| 8 | **用户手动缩放后要停自动适应** — 否则缩放被 RO re-fit 吃掉(页面始终「充满窗口」,只变清晰度不变大小) | `userZoomed` 标志:缩放时切固定数值 scale + 标记,RO 跳过;新文件 setFile 重置 |
| 9 | **wheel 缩放库不带** — pdfjs v5 npm 库不打包 wheel/pinch 处理(在 web/app.mjs) | 自己接 `Ctrl/Cmd+wheel`,trailing throttle ~150ms(防 trackpad 惯性 churn) |
| 10 | **textLayer span 继承 `user-select: none`** — 从 Obsidian view 祖先继承,选不了字 | CSS `!important` 强制 `.textLayer span { user-select: text }` |
| 11 | **loading-icon.gif 404** — pdfjs 的相对 url 在 Obsidian 下解析到不存在的 `app://obsidian.md/images/` | CSS override 掉 spinner 背景(cosmetic) |
| 12 | **读取 PDF 用 `getResourcePath + fetch`** — `vault.adapter.readBinary` 在 macOS TCC 下 EPERM(渲染进程 Node fs 被挡) | 改用 `app.vault.adapter.getResourcePath(file.path)` + `fetch().arrayBuffer()`(走 webview 有权限层) |

**DevTools 伪影**:开 DevTools 会改视口宽度 → reflow → textLayer 选区短暂错位 + canvas 模糊。**关 DevTools 正常**。非真 bug,但 MVP 测试要注意。

**英文选区偏移**(小 wart):CJK 完美(#20334 修复生效),英文轻微后偏移(per-font `--scale-x` 度量问题,非通用)。CJK-first 产品可接受;MVP 再调或按 PDF 字体处理。

---

## 3. E6 用户实测反馈摘要(3 位)

| 用户 | 画像 | 评分(均) | 核心反馈 |
|---|---|---|---|
| 用户1 小王 | 研究生/Zotero(16G Mac) | ~2.3 | 选区差(showstopper);打开慢;要双击打开+tab;无页码/缩放;「PDF 阅读器多余,想不逐字读就知道核心内容」;愿付 ¥128-198/年(深度问答+跨文献+结构化笔记) |
| 用户2 李姐 | PM/微信读书(8G Air) | ~1.8 | 中文选区不可用(行尾/边缘误选);要双击打开+tab;界面简陋;想做「可视化知识图谱,缩放改广度,点节点弹子页」;愿付 ¥98-128 买断/¥12-15 月 |
| 用户3 老赵 | 顾问/Preview+Notion(32G) | ~2.5 | 选区 showstopper;打开反人类;「阅读器是基础设施不是卖点,核心是 AI 帮你更高效阅读不是替你阅读;跨PDF搜索+AI回答+引用溯源比图谱实在」;图谱「演示惊艳实际玩具,Obsidian 自带 graph 哇然后不用」;愿付 $3-5/月 或 $40-60 买断 |

**共识**(3/3):单纯阅读器+高亮不付费;愿付费的是 **AI 深度问答 + 跨文献知识关联 + 高亮→结构化笔记自动生成**。
**分歧**:图谱(用户2 想要可视化图谱;用户3 警告是玩具)。

---

## 4. 战略重定位

**原定位**(spec 2026-07-23):CJK-first 的本地 PDF 阅读高亮 + AI 对话 + 微信读书导入,阅读器是核心闭环。

**新定位**(开发者决策,2026-07-27,基于 E6 反馈):
- **阅读器 = 基础设施**(不是卖点)。作用:让用户方便手动圈选/调整想要的知识。spike 级「够用」即可(渲染 + CJK 选区 + 自适应 + 缩放)。剩余 wart(英文偏移/缩放外观/工具栏/深色模式)延后。
- **核心 = AI 快速知识点抽取 + 总结 + Obsidian 动态知识图谱导航**。理由:人类阅读速度远不满足信息获取需求;AI 抽取+总结让用户不逐字读就拿到核心;图谱做导航/关联层。
- **AGPL 核心 + v2 后端订阅**(不变,spec 原 B 章节)。

这与 spec 原 P9 定位洞察一致(阅读器=基础设施,AI+跨书+结构化笔记是付费点),现在是把洞察**升为首要 KPI**。

---

## 5. 分阶段计划

### Phase 1(验证 A):AI 抽取喂 Obsidian 自带图谱 + 轻量节点摘要叠加层
- AI 从 PDF/笔记抽知识点 → 每个知识点一条 Obsidian 笔记(带 `[[源PDF]]` 双向链接 + 标签 + frontmatter 源页码/抽取日期)→ Obsidian 自带 graph 自动导航(免费,按标签/文件夹聚焦 ≈ 缩放广度)
- 叠加自定义 view:点知识笔记 → AI 汇总该知识点所有关联笔记 + PDF 段落 + 引用溯源(「弹子页」)
- 核心价值 = AI 抽取 + RAG(user3 认可方向);图谱不重造
- 验证目标:用户**真用**图谱 + AI 摘要(对冲 user3 的「玩具」风险)

### Phase 1.5:测 Obsidian 自带图谱的开发自由度
- 关键判定线:用户的两个后期可视化需求 ——
  1. 搜知识点 → 视角定位 + 高亮
  2. 问问题 → AI 分析 → 高亮知识点链路
- 现实预判:Obsidian 自带 graph view **几乎不暴露编程控制**(无法脚本化「聚焦节点 X + 高亮路径 Y」)。所以 Phase 1.5 大概率结论 = 自建图谱。
- 但自带图谱对「自由浏览/缩放/点击进笔记」够用;只是不够「编程定位/高亮链路」。

### Phase 2(条件触发,基于 Phase 1.5 结论):
- 若自带图谱自由度够 → 在它上面做可视化增强(搜索定位+高亮、AI 问题→知识点链路高亮)
- 若不够(预期) → **自建图谱**(D3/force-directed,节点=知识点,语义缩放,点节点=AI 汇总子页)。
- 自建图谱是最大工程,Phase 1 验证「图谱+AI 摘要真有人用」后才投入(对冲「造了玩具」)。

---

## 6. 不变项(沿用 spec)

- 名:拾阅 / Shiyue,插件 ID `shiyue`,AGPL-3.0,v2 后端做订阅(不 relicense)
- pdfjs v5.4.530(引擎天花板)
- 读取用 `getResourcePath + fetch`(TCC)
- v2 后端订阅期权保留(用户愿付费区间 ¥128-198/年 或 $3-5/月,印证了后端+订阅模式的付费意愿——比买断更有先例)
- 阅读器代码(spike `w0-spike` 分支)作为 MVP 基础设施底座保留,继续用 PDFViewer embed

---

## 7. 下一步

1. 设计 Phase 1(A):AI 知识点抽取 pipeline + 笔记 schema + 轻量 RAG 节点摘要 view(新 brainstorm + spec)
2. 写 Phase 1 实现计划(writing-plans)
3. 执行(在 `w0-spike` 分支或新分支上,复用 PDF reader 基础设施)

*本文档替代 spec 中「spike 待验证」的占位,作为 MVP 设计的事实基础。*
