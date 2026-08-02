# 07 — spec 缺失功能:汇总存回笔记 + 溯源页码跳转

**What to build:** 实现两个 spec §6 列出但 v1 漏/延后的功能,补全后再发布:
1. **存回笔记(save-to-note)**:汇总完成后,把综合摘要追加到当前知识点笔记的 `## 综合汇总` 章节(spec §6「保存(可选):点『追加到当前笔记』→ 把汇总追加到 `## 综合汇总` 章节」)。原标 optional,v1 静默缺,非延后-标注。
2. **溯源页码跳转(page-jump)**:汇总输出 `[[笔记]](pN)` 渲染成**两个可点 affordance**(grill 定,2026-08-03):
   - `[[笔记]]` 部分 → 开该笔记(常规 internal-link 行为,现状 openInPreview=openInShiyue)。**不变**。
   - `(pN)` 部分 → 渲成独立可点 → 解析相邻笔记的 frontmatter `source_pdf` + `source_page` → openInShiyue(源 PDF) + 导航原生 PDF viewer 到第 N 页。

**Blocked by:** None — can start immediately(承 preview-context #01/#02 的 openInPreview primitive)。

**Status:** ready-for-agent

## 设计决策(grill 定)

### 存回笔记
- 触发:汇总渲染完成后,AI 面板 synthesisEl 下方显「存回笔记」按钮(或 synthesis 完成时显)。i18n:新增 `panel.btn.saveSynth` / `notice.synthSaved` / `notice.synthSaveFail`。
- 行为:读当前知识点笔记(汇总的 `file.path`),把综合摘要 markdown 追加到其 `## 综合汇总` 章节(章节不存在则创建;已存在则追加到该章节末尾,在下一 `## ` 前或文末)。用 `vault.process`/`modify`(spec D4 串行写,防 `file.saving` 永真丢数据)。
- 边界:笔记已删/被外部改 → 读-改-写 race;用 `vault.process`(原子)或读后比对 mtime。空 synthesis(honest-sparse 单篇聚合)亦可存。

### page-jump(两个 affordance)
- `[[笔记]]` click:**不变**(openInPreview=openInShiyue 开笔记)。
- `(pN)` click:解析 `(N)` 取页码 + 取相邻 `a.internal-link` 的 `data-href` → resolve 笔记 TFile → 读其 frontmatter `source_pdf`(`[[书名.pdf]]` 形式)→ 解析 source pdf TFile → `openInShiyue(sourcePdf)` + 导航 PDF viewer 到第 N 页。
- **(pN) 渲成独立可点 = 本 ticket 的 fiddly 部分(implement-time 定)**:两路——
  - (a) MarkdownRenderer 渲完 DOM 后 post-process:找 `a.internal-link`,检查其后 text node 是否 `(N)`,包成可点 span。脆(text-node walking)。
  - (b) 改 synthesizer 输出格式:把 `[[笔记]](pN)` 改成 `[[笔记]]`(常规)+ 紧跟一个可点 token(如 `` `pN` `` code 或自定义 span),MarkdownRenderer 渲成独立元素。需改 `buildSynthesisPrompt` 要求 + 输出 + `synthesizer.test.ts` 断言。
  - 实现者择优;`buildSynthesisPrompt` 是中英混合 LLM 指令(不 i18n,改格式可能影响质量 → 验)。
- **PDF 页码导航 API = runtime-unknown(implement-time probe)**:原生 PDFView 是否暴露 `setPage`/`scrollToPage`/page hash?probe `previewCtx.getPreviewLeaf().view` 的 PDF view 成员。fallback:开到第 1 页 + Notice「页码跳转暂不可用」(不阻塞存回笔记)。

## Acceptance criteria
- [ ] 存回笔记:`## 综合汇总` 章节创建/追加正确;`vault.process` 串行写;空 synthesis 亦可存;Notice 提示成功/失败(i18n)。
- [ ] page-jump `(pN)` 可点(implement 选 (a) 或 (b));点击 → 开源 PDF + 导航到第 N 页(runtime 验;若 PDF view 无 page-nav API → fallback 开 p1 + Notice)。
- [ ] `[[笔记]]` click 行为不变(仍 openInPreview 开笔记)—— 不回归 3b。
- [ ] i18n:新增 user-facing key(panel.btn.saveSynth / notice.synthSaved / notice.synthSaveFail / notice.pageJumpUnavailable)走 `t()`,zh-CN+en;LLM prompt 不 i18n。
- [ ] `npm run build` clean;`node --test` 全绿(synthesizer 若改输出格式 → 更新 `synthesizer.test.ts` 断言;存回笔记若抽纯逻辑「append synth section to note text」→ 单测)。
- [ ] 人工验:汇总后「存回笔记」→ 笔记出现 `## 综合汇总` + 内容;点 `[[笔记]]` → 开笔记(不回归);点 `(pN)` → 开源 PDF 跳页 N(或 fallback Notice)。

## Out of scope
- 不动 PreviewContext/PreviewSplit(#01/#02 已成稳定)。
- page-jump 若 PDF view 无 page-nav API → fallback(开 p1 + Notice),不强造;记为已知限制(ADR-0004 风格)。
- 不实现 spec 其它延后项(向量 Phase 1.5 / 自建图谱 Phase 2 / 聊天 Agent)。

## Comments
- 2026-08-03 — grill 定(两 affordance:「note link + separate (pN) link」,spec-faithful「该笔记 + 该页」)。源:code-review Spec 轴发现 save-to-note(spec §6 optional)静默缺 + page-jump(spec §6 / synthesis spec Out-of-Scope「page 定位延后」)。用户要求补全后再发布。两个 implement-time unknown:(pN) 独立可点渲染法 + PDF 页码导航 API → 各标 fallback/verify。
