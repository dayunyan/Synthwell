---
status: accepted
---

# #07: 溯源页码跳转 — 两个 affordance + PDF 页码导航探测

汇总输出 `[[笔记]](pN)` 渲染成**两个可点 affordance**(grill 定,2026-08-03):

- `[[笔记]]` → 开该笔记(复用 openInPreview=openInShiyue,不变,不回归 Bug 3)。
- `(pN)` → 解析相邻笔记的 frontmatter `source_pdf` + 页码 N → 开源 PDF + 导航原生 PDF viewer 到第 N 页。

## (pN) 独立可点:方案 (a) post-process DOM(不选 (b) 改输出格式)

`[[笔记]](pN)` 里 `[[笔记]]` 被 Obsidian 渲成 `a.internal-link`,`(pN)` 是其后的 Text 节点。两路选(见 #07 ticket):

- **(a)** MarkdownRenderer 渲完 DOM 后 post-process:遍历 `a.internal-link`,若其后 Text 节点以 `(pN)` 开头,包成 `.shiyue-page-jump` span。脆性限于 text-node walking。
- **(b)** 改 `buildSynthesisPrompt` 要求 LLM 输出不同格式(`[[笔记]]` + 可点 token)。

**选 (a)。** `buildSynthesisPrompt` 是中英混合 LLM 指令(不 i18n),改输出格式可能影响综合质量(ticket 明示「验」);且 LLM 自然产出 `[[笔记]](pN)`(学术引用常态,prompt 即如此要求)。方案 (a) 不动 synthesizer 输出 → `synthesizer.test.ts` 不回归,脆性只在本 DOM 胶水(与 `selection-capture.ts` 同属「DOM 胶水不单测、人工验」一类)。`decoratePageJumps` 容 `[[笔记]] (pN)`(前置空白)与 `(pN) 余文`(包 `(pN)` 留余文)。

## PDF 页码导航 API:运行时探测 + DOM 兜底 + Notice 末态

原生 PDF view 的页码导航 API **类型未公开**(obsidian.d.ts 仅暴露 `loadPdfJs()`,无 `PdfView`/`setPage`)。运行时按存在性探测:

1. **JS API**:试 `view` 的 `setPage`/`gotoPage`/`scrollToPage`/`setPageNumber`;次试 `view.viewer`/`view.pdfViewer` 的 `currentPageNumber` setter(pdfjs PDFViewer)。有则调、返成功。
2. **DOM 兜底**:pdfjs 渲 `.page[data-page-number]`(`findPageNumber` 已依赖此公开 DOM 结构)→ 轮询至多 ~2s 等元素出现 → `scrollIntoView({block:'start'})`。非 monkey-patch pdfjs 内部,只滚动已渲染的公开 DOM 节点。
3. **Notice 末态**:两者都失败 → 调用方显「页码跳转暂不可用,已打开第 1 页」(源 PDF 已开,仅页码定位失败)。

**不强造**:不 monkey-patch pdfjs contextmenu / viewer 内部。DOM 兜底属「用公开 DOM 结构」(与 findPageNumber 同源),非「hack 内部」。两层都失败时如实 Notice,记为已知限制——存回笔记不受此影响(#07 ticket「不阻塞存回笔记」)。

## 已知限制

- PDF view 不暴露任何页码 API 且 DOM 渲染异常 → 跳页降级为开 p1 + Notice(不阻塞)。
- `(pN)` 必须紧跟 `[[笔记]]`(相邻 Text 节点)才被包;LLM 若把页码写到非紧邻位置则不识别(降级为不可点纯文本,不报错)。
