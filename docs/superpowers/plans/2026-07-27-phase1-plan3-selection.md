# 拾阅 Phase 1 — Plan 3: SelectionExtractor(选区即抽)+ 双击打开 + 右键菜单

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PDF 视图里选中一段文字 → 右键「深抽这个知识点」→ AI 基于(选中 + 上下文 ±2 页 + 已有笔记标题)抽一个知识点 → 生成笔记 + 自动打开。外加:双击 vault 里的 `.pdf` 直接用拾阅打开(替换 Obsidian 默认查看器),新 tab 打开。砍掉命令面板作主入口(E6 一致要求)。

**Architecture:** 纯逻辑(SelectionExtractor.extract:上下文组装 + prompt + 单点解析;NoteGenerator 加 related_reasons 渲染)用 node:test TDD(注入 mock LLM);Obsidian 耦合(PdfView.getSelection 缓存选区、右键 Menu、FileView + registerExtensions 双击打开)人工验。复用 Plan 1/2 的 `OpenAICompatibleProvider`、`parseLLMJson`、`NoteGenerator`、`normalizePoint` 思路、`ensureFolder`。

**Tech Stack:** TypeScript、obsidian API、pdfjs-dist v5.4.530、node:test。Branch `w0-spike`。

**关联 spec:** `docs/superpowers/specs/2026-07-27-phase1-ai-extraction-design.md` §1.1(UX 入口)+ §5(选区抽取器)。
**关联 Plan 2:** 复用 `src/llm-service.ts`、`src/llm-json.ts`、`src/note-generator.ts`、`src/vault-fs.ts`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/selection-extractor.ts` | `SelectionExtractor.extract`(选区→单点深抽:上下文组装 + prompt + 解析 + 归一) |
| `src/note-generator.ts`(改) | `KnowledgePoint` 加 `related_reasons?`,`renderNote` 的 `## 关联` 支持带理由 |
| `src/pdf-view.ts`(改) | `onSelectionEnd` 缓存最近选区;加 `getSelection(): {text,page}\|null`;改 extends `FileView`;加 `getDocument()` |
| `src/main.ts`(改) | `extractSelection(view)`;`registerExtensions(['pdf'])`;右键 Menu 接入;`getLeaf(true)` 新 tab |
| 测试 | `src/{selection-extractor,note-generator}.test.ts` |

---

### Task 1: SelectionExtractor.extract(选区→单点深抽,纯逻辑 TDD)

**Files:** Create `src/selection-extractor.ts`; Test `src/selection-extractor.test.ts`

**复用:** `parseLLMJson` from `./llm-json.ts`、`LLMProvider`/`ChatMsg` type from `./llm-service.ts`。

- [ ] **Step 1: 写失败测试** (`src/selection-extractor.test.ts`):

```typescript
import { test } from "node:test";
import assert from "node:assert";
import { SelectionExtractor } from "./selection-extractor.ts";
import type { LLMProvider, ChatMsg } from "./llm-service.ts";

test("SelectionExtractor.extract: 组装 prompt(选中+上下文+已有标题+书名)→ 解析单点", async () => {
  let captured = "";
  const llm: LLMProvider = {
    async chat(msgs: ChatMsg[]) { captured = msgs[0].content ?? msgs[msgs.length-1].content; return JSON.stringify({ title: "飞轮效应", summary: "正向循环让强者愈强。", source_page: 3, tags: ["增长", "飞轮"], related: [{ title: "网络效应", reason: "都讲平台价值随用户增长" }] }); },
    async *stream() { throw new Error("no"); }, abort() {},
  };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("增长策略.pdf", "飞轮效应是指业务各环节互相强化", 3, "第1页…第2页…第3页…第4页…第5页", ["网络效应", "好战略坏战略"]);
  assert.ok(pt);
  assert.equal(pt!.title, "飞轮效应");
  assert.equal(pt!.source_page, 3);
  assert.deepEqual(pt!.tags, ["增长", "飞轮"]);
  assert.equal(pt!.related.length, 1);
  assert.equal(pt!.related[0].title, "网络效应");
  assert.ok(captured.includes("增长策略.pdf"), "书名入 prompt");
  assert.ok(captured.includes("飞轮效应是指业务各环节互相强化"), "选中段入 prompt");
  assert.ok(captured.includes("第3页"), "上下文入 prompt");
  assert.ok(captured.includes("网络效应"), "已有标题入 prompt");
});

test("SelectionExtractor.extract: LLM 返回非 JSON → 返回 null(不抛)", async () => {
  const llm: LLMProvider = { async chat() { return "这不是 JSON"; }, async *stream() { throw 0; }, abort() {} };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("b.pdf", "选中", 1, "上下文", []);
  assert.equal(pt, null);
});

test("SelectionExtractor.extract: 把点包在对象里 {point:{...}} → 抠出来", async () => {
  const llm: LLMProvider = { async chat() { return JSON.stringify({ point: { title: "点A", summary: "s", source_page: 1, tags: [], related: [] } }); }, async *stream() { throw 0; }, abort() {} };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("b.pdf", "选中", 1, "上下文", []);
  assert.ok(pt && pt.title === "点A");
});

test("SelectionExtractor.extract: 缺 title 或 related 非数组 → 归一,不炸", async () => {
  const llm: LLMProvider = { async chat() { return JSON.stringify({ summary: "s", source_page: "5", tags: "x", related: null }); }, async *stream() { throw 0; }, abort() {} };
  const se = new SelectionExtractor(llm);
  const pt = await se.extract("b.pdf", "选中", 2, "上下文", []);
  assert.equal(pt, null);  // 无 title → 丢弃
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/selection-extractor.test.ts` → FAIL(找不到模块)

- [ ] **Step 3: 写最小实现** (`src/selection-extractor.ts`):

```typescript
import type { LLMProvider, ChatMsg } from "./llm-service.ts";
import { parseLLMJson } from "./llm-json.ts";

export interface SelectionRelated { title: string; reason: string; }
export interface SelectionPoint {
  title: string; summary: string;
  source_page: number;
  tags: string[];
  related: SelectionRelated[];
}

/** 从 LLM 返回里抠出单个点对象:裸对象 / {point:{...}} / [{}]。 */
function extractObject(raw: any): any | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw)) return raw;
  return raw[0] ?? null;
}

/** 归一化单点:强转类型,缺 title → null,related 非数组 → []。 */
function normalizeSelectionPoint(raw: any, fallbackPage: number): SelectionPoint | null {
  const o = extractObject(raw);
  if (!o) return null;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  const page = Number(o.source_page);
  const related: SelectionRelated[] = Array.isArray(o.related)
    ? o.related.filter((r: any) => r && typeof r.title === "string" && r.title.trim())
      .map((r: any) => ({ title: String(r.title).trim(), reason: typeof r.reason === "string" ? r.reason.trim() : "" }))
    : [];
  return {
    title,
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(o.tags) ? o.tags.filter((t: any) => typeof t === "string" && t.trim()) : [],
    related,
  };
}

/** 选区即抽:基于(选中段 + 上下文 + 已有知识点标题)抽单个知识点,带 related 理由。
 *  纯逻辑:contextText / existingTitles 由调用方组装(main.ts 从 doc + vault 拿)。 */
export class SelectionExtractor {
  constructor(private llm: LLMProvider) { this.llm = llm; }
  async extract(book: string, selected: string, page: number, contextText: string, existingTitles: string[]): Promise<SelectionPoint | null> {
    const titlesBlock = existingTitles.length ? existingTitles.map(t => `- ${t}`).join("\n") : "(无)";
    const prompt = `你是知识抽取助手。用户从《${book}》第 ${page} 页选中了一段,想把它抽成一个知识点笔记。
基于选中段 + 上下文,提取一个知识点:title(名词短语)、summary(2-4 句)、source_page(所在页码)、tags(2-3 个主题标签)。
并从已有知识点标题里找出关联的(给 related 列表,每个附一句关联理由)。
只返回 JSON:{"title","summary","source_page","tags","related":[{"title","reason"}]}

选中:${selected}
上下文(第 ${Math.max(1, page - 2)}-${page + 2} 页):${contextText}
已有知识点:
${titlesBlock}`;
    const raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2 });
    const parsed = parseLLMJson<any>(raw);
    if (parsed == null) return null;
    return normalizeSelectionPoint(parsed, page);
  }
}
```
(注:`constructor(private llm: LLMProvider)` 是 TS 参数属性,`--experimental-strip-types` 不支持。改用显式字段:`private llm: LLMProvider; constructor(llm: LLMProvider){ this.llm = llm; }`。)

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/selection-extractor.test.ts` → PASS(4/4)

- [ ] **Step 5: Commit**
```bash
git add src/selection-extractor.ts src/selection-extractor.test.ts
git commit -m "feat(shiyue): SelectionExtractor.extract single-point deep extract (plan3 task1)"
```

<!-- MORE -->

---

## 自审

**1. Spec 覆盖**:Plan 3 覆盖 spec §5(SelectionExtractor:Task 1 单点深抽 + 上下文 ±2 页 + 已有标题 + related 理由;Task 4 编排 + 打开)+ §1.1 的「右键菜单深抽」(Task 5)+「双击 .pdf 打开 + 新 tab」(Task 6,含 D8 推翻 V1.5)+「FileView 路由」。**未覆盖(延到 Plan 3b)**:§1.1 的「视图内工具栏」(页码/缩放/「抽取整篇」按钮/暗色)+「选中浮起迷你工具栏」(复制/深抽/问 AI)。**为什么延**:工具栏是 UX 打磨,不是新能力;批处理抽取当前走命令面板(Plan 2 已验可用),selection 走右键(Task 5,主交互到位)。把工具栏单拎一个 Plan 3b,避免 Plan 3 膨胀 + 让 selection 能力先落地。批处理命令触发是 interim(同 Plan 2 Task 8 的命令触发),Plan 3b 再换工具栏按钮。

**2. 占位符扫描**:无 TBD。Task 6 的 FileView 生命周期(`onOpen` 里 `if (this.file) await this.setFile(this.file)`)标注了 setFile 重入(cleanup 旧 doc)——是有意设计(双击路由 → FileView 设 file → onOpen 加载),非偷懒。同 leaf 换文件(FileView 的 setState 重新加载)在 MVP 不处理(双击每次新 tab `getLeaf(true)` → 新 view → onOpen),标为已知局限。

**3. 类型一致性**:`SelectionPoint`/`SelectionRelated`(Task 1)↔ `KnowledgePoint.related_reasons`(Task 2,`{title, reason}[]` 形状一致)↔ `extractSelection` 传参(Task 4,`related: point.related.map(r=>r.title)` + `related_reasons: point.related`)一致。`PdfView.getSelection(): {text, page} | null`(Task 3)↔ `extractSelection` 读 `sel.text`/`sel.page`(Task 4)一致。`getDocument(): PDFDocumentProxy | null`(Task 3)↔ `extractSelection` 取 ±2 页(Task 4)一致。`SHIYUE_PDF_VIEW` 复用 Plan 1。

**4. 实现期注意点**:
- Task 1 的 `SelectionExtractor` 构造用**显式字段**(`private llm; constructor(llm){ this.llm=llm }`),不要用 TS 参数属性(`--experimental-strip-types` 不支持,Plan 2 踩过)。
- Task 5 的 `this.plugin` cast:`(this.plugin as { extractSelection?: (v: PdfView) => void })`——避免 pdf-view ↔ main 循环 import。
- Task 6 的 `FileView` 改继承后,**删掉 PdfView 自己的 `file: TFile | null` 字段**(FileView 已提供,重复会遮蔽 + 报 TS)。`extractCurrentPdf`(Plan 2)用 `view.file`——FileView 的 file 仍可读,不破。
- Task 6 `registerExtensions(['pdf'], SHIYUE_PDF_VIEW)` 会让**所有** .pdf 双击都走路由(含 Obsidian 原本默认查看器)——这是 spec D8 有意为之;用户要原查看器可禁用拾阅。

---

## 后续

- **Plan 3b**:视图内工具栏(页码/缩放/「抽取整篇」按钮——把批处理从命令移进视图)+ 选中浮起迷你工具栏(复制/深抽/问 AI)+ 暗色切换。
- **Plan 4**:KnowledgePanel RAG 叠加层(标签/backlink 关联 + AI 汇总 + 溯源)。
- **Phase 1.5**:向量语义检索(vectra,验证 RAG 真有人用后)。

*Plan 3 完成 + 人工验(选区深抽 + 双击打开)通过后,进 Plan 3b 或 Plan 4。*

### Task 5: PdfView 右键「深抽这个知识点」菜单(人工验)

**Files:** Modify `src/pdf-view.ts`

E6 主交互:选中文本后右键 → Menu「深抽这个知识点」→ 调 `plugin.extractSelection(this)`。替换 Task 4 的 interim 命令作主入口(命令保留作辅助)。

- [ ] **Step 1: 加 Menu + contextmenu 监听** (改 `src/pdf-view.ts`):

import 顶部加 `Menu`:
```typescript
import { ItemView, Plugin, WorkspaceLeaf, TFile, Menu } from "obsidian";
```
(`FileView` 在 Task 6 再加,本任务先不动 extends。)

`onOpen` 里(在 `registerDomEvent(... "mouseup" ...)` 之后)加 contextmenu:
```typescript
    this.registerDomEvent(this.contentEl, "contextmenu", (e: MouseEvent) => {
      if (!this.lastSelection) return;  // 无选区 → 用 Obsidian 默认菜单(复制等)
      e.preventDefault();
      const menu = new Menu();
      menu.addItem(item => item.setTitle("深抽这个知识点").setIcon("sparkles")
        .onClick(() => (this.plugin as { extractSelection?: (v: PdfView) => void }).extractSelection?.(this)));
      menu.showAtMouseEvent(e);
    });
```
(注:`this.plugin` 类型是 `Plugin`,ShiyuePlugin 的 `extractSelection` 在子类。用内联类型 cast 避免循环 import(pdf-view ↔ main)。`?.` 保证 Task 4 未做时静默,但 Task 4 已做,会正常调。)

- [ ] **Step 2: 构建** — `npm run build` → clean

- [ ] **Step 3: 人工验证** — 测试 vault:
  1. 用拾阅打开 PDF,选中一段文字
  2. 右键 → 菜单出现「深抽这个知识点」(✨ 图标)
  3. 点 → 深抽 → 笔记生成 + 打开(同 Task 4)
  4. 不选文字直接右键 → 不出拾阅菜单(Obsidian 默认菜单)

### Task 6: 双击 .pdf 用拾阅打开(registerExtensions + FileView + tab,人工验)

**Files:** Modify `src/pdf-view.ts`(extends FileView); Modify `src/main.ts`(registerExtensions + getLeaf(true))

E6 必做:双击 vault 文件列表里的 `.pdf` → 直接在拾阅打开(像 markdown 一样自然),新 tab。当前是 `ItemView` + 命令打开;改 `FileView` 让 Obsidian 把 `.pdf` 路由到拾阅 view。

- [ ] **Step 1: PdfView extends FileView** (改 `src/pdf-view.ts`):

import 加 `FileView`:
```typescript
import { ItemView, Plugin, WorkspaceLeaf, TFile, Menu, FileView } from "obsidian";
```
class 改继承 + 删自己的 `file` 字段(FileView 已提供):
```typescript
export class PdfView extends FileView {
  // file: TFile | null = null;  ← 删:FileView 已提供 this.file
  private readonly plugin: Plugin;
  ...
```
`onOpen` 末尾(现有 DOM 设置之后)加:若已有 file(双击路由/命令打开),加载:
```typescript
    if (this.file) await this.setFile(this.file);
```
(注:`onOpen` 现在只设空占位 + 选区/右键监听。FileView 在路由时设好 `this.file` 再调 `onOpen`,故此处能拿到。`setFile` 改成可重入——若 `this.doc` 已存在先 cleanup 旧的:在 `setFile` 开头加 `if (this.doc) { await this.doc.destroy(); this.doc = null; } this.userZoomed = false;`。)

- [ ] **Step 2: main.ts registerExtensions + tab 打开** (改 `src/main.ts`):

`onload` 里(`registerView` 之后)加:
```typescript
    this.registerExtensions(["pdf"], SHIYUE_PDF_VIEW);  // 双击 .pdf → 拾阅 view
```
`openPdf` 改新 tab(原 `getLeaf("split", "vertical")`):
```typescript
  async openPdf(file: TFile) {
    const leaf = this.app.workspace.getLeaf(true);  // 新 tab(E6:当前编辑区新 tab)
    await leaf.openFile(file);  // FileView 路由:setFile 由 onOpen 触发
  }
```
(`openFile` 走 registerExtensions 路由 → FileView.onload → setFile。原 `setViewState + view.setFile` 不再需要。)

- [ ] **Step 3: 构建** — `npm run build` → clean

- [ ] **Step 4: 人工验证** — 测试 vault:
  1. 重载插件
  2. 文件列表双击一个 `.pdf` → 拾阅 view 打开(新 tab),不是 Obsidian 默认查看器
  3. PDF 渲染 + 可选中 + 右键深抽(前几步功能不回归)
  4. 命令「拾阅: 打开 PDF」→ picker → 选文件 → 仍能打开(tab)
  5. 关闭 view → 内存释放(spike E3 不回归)

### Task 4: main.ts extractSelection(view)+ interim 命令(人工验)

**Files:** Modify `src/main.ts`

接 `view.getSelection()` → 组装上下文 ±2 页(用 `view.getDocument()`)+ 已有笔记标题(扫 notesPath)→ `SelectionExtractor.extract` → `NoteGenerator.generate`(传 related + related_reasons)→ 打开笔记。interim 用命令触发(Task 5 再加右键菜单)。

- [ ] **Step 1: 加 import + 命令 + 方法** (改 `src/main.ts`):

import 区加:
```typescript
import { SelectionExtractor } from "./selection-extractor";
import { pageTextFromItems } from "./highlight";  // 复用 spike 的拼页文本
```
(注:`pageTextFromItems` 在 `src/highlight.ts`,spike 已有,Plan 1 验过。)

`onload` 里加命令(在 extract-knowledge-points 命令之后):
```typescript
    this.addCommand({
      id: "extract-selection",
      name: "拾阅: 深抽选中知识点(当前打开的 PDF)",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getLeavesOfType(SHIYUE_PDF_VIEW)[0];
        const view = leaf?.view;
        if (!(view instanceof PdfView) || !view.file) return false;
        if (checking) return true;
        this.extractSelection(view).catch((e: unknown) => new Notice(`深抽失败:${e instanceof Error ? e.message : String(e)}`, 8000));
      },
    });
```

加方法到 `ShiyuePlugin`(放 `extractCurrentPdf` 附近):
```typescript
  /** 选区即抽:选中段 + 上下文 ±2 页 + 已有笔记标题 → AI 抽单点 → 生成笔记 + 打开。 */
  async extractSelection(view: PdfView) {
    const sel = view.getSelection();
    if (!sel || !sel.text) { new Notice("请先在 PDF 中选中一段文字", 4000); return; }
    if (!view.file) { new Notice("没有打开的 PDF"); return; }
    const doc = view.getDocument();
    if (!doc) { new Notice("PDF 未加载完成"); return; }
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({ baseURL: this.settings.baseURL, apiKey, model: this.settings.model });
    // 上下文:选中页 ±2 页的文本
    const contextPages: string[] = [];
    for (let pg = Math.max(1, sel.page - 2); pg <= Math.min(doc.numPages, sel.page + 2); pg++) {
      const p = await doc.getPage(pg);
      const tc = await p.getTextContent();
      contextPages.push(`第${pg}页:${pageTextFromItems(tc.items.map((it: any) => ({ str: it.str ?? "" })))}`);
    }
    // 已有笔记标题(扫 notesPath 下 .md,限 500)
    const existing = this.app.vault.getFiles()
      .filter(f => f.path.startsWith(this.settings.notesPath) && f.extension === "md")
      .map(f => f.basename).slice(0, 500);
    new Notice("深抽中…", 2000);
    const se = new SelectionExtractor(provider);
    const point = await se.extract(view.file.basename, sel.text, sel.page, contextPages.join("\n"), existing);
    if (!point) { new Notice("未能抽取(模型未返回有效结果)", 4000); return; }
    const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: this.settings.notesPath, model: this.settings.model });
    const path = await noteGen.generate({
      title: point.title, summary: point.summary, source_pdf: view.file.basename, source_page: point.source_page,
      source_text: sel.text, tags: point.tags, related: point.related.map(r => r.title), related_reasons: point.related,
      model: this.settings.model, extraction_mode: "selection",
    });
    new Notice(`✓ 已生成:${point.title}`, 4000);
    const nf = this.app.vault.getAbstractFileByPath(path);
    if (nf instanceof TFile) await this.app.workspace.getLeaf().openFile(nf);  // 自动打开笔记
  }
```

- [ ] **Step 2: 构建** — `npm run build` → clean(tsc 报错则修,主要是 imports + TFile 已在)

- [ ] **Step 3: 人工验证** — 测试 vault:
  1. 用拾阅打开 PDF,选中一段文字
  2. 命令「拾阅: 深抽选中知识点(当前打开的 PDF)」
  3. 进度「深抽中…」
  4. 完成「✓ 已生成:{标题}」+ 笔记自动打开
  5. 检查笔记:frontmatter(`extraction_mode: selection`)+ `## 原文` 是选中段 + `## 关联` 带 `[[title]] — reason`

### Task 3: PdfView.getSelection() + getDocument()(缓存 spike 选区,人工验)

**Files:** Modify `src/pdf-view.ts`

spike 的 `onSelectionEnd`(L129-166)已算出 `selected` 文本 + `page`(从 `.page[data-page-number]`)。加个字段缓存,暴露 `getSelection(): {text, page} | null`(SelectionExtractor 主入口)+ `getDocument()`(取上下文 ±2 页文本用,复用已加载的 doc,免重新 fetch)。

- [ ] **Step 1: 加字段 + 暴露方法** (改 `src/pdf-view.ts`):

在 `PdfView` 字段区(约 L95 `userZoomed` 附近)加:
```typescript
  // 最近一次选区(mouseup 缓存)。SelectionExtractor 的主输入。
  private lastSelection: { text: string; page: number } | null = null;
```

改 `onSelectionEnd`:在算出 `page` 后、try 建 anchor 之前,缓存选区(即使 anchor 建失败,getSelection 仍可用):
```typescript
    const page = Number(pageEl.dataset.pageNumber);
    if (!page || !this.doc) return;
    this.lastSelection = { text: selected, page };  // Plan 3: 缓存供 SelectionExtractor
```
(把这一行插在原 `if (!page || !this.doc) return;` 之后、`try {` 之前。其余 anchor 逻辑保留——spike 的可观测日志仍有用。)

加两个公开方法(放在 `getViewType`/`getDisplayText` 附近):
```typescript
  /** 最近一次选区(文本 + 页码);无则 null。SelectionExtractor 的主输入。 */
  getSelection(): { text: string; page: number } | null { return this.lastSelection; }
  /** 已加载的 PDF 文档(取上下文 ±2 页文本用;复用,免重新 fetch)。未加载则 null。 */
  getDocument(): PDFDocumentProxy | null { return this.doc; }
```

`onClose` 里清掉缓存(放在 `this.doc = null` 附近):
```typescript
    this.lastSelection = null;
```

- [ ] **Step 2: 构建** — `npm run build` → clean。

- [ ] **Step 3: 人工验证(无单测——DOM 选区)** — 测试 vault:
  1. 用拾阅打开一个 PDF
  2. 选中一段文字
  3. 开发者工具 Console 应继续打 `[shiyue] mouseup selection=...` + `[shiyue] anchor ...`(spike 日志保留)
  4. Console 输入 `app.workspace.getLeavesOfType('shiyue-pdf-view')[0].view.getSelection()` → 应返回 `{text: "...", page: N}`(或当前 view 实例)
  5. 输入 `.getDocument()` → 应返回 PDFDocumentProxy 对象(`numPages` 可见)

### Task 2: NoteGenerator `## 关联` 支持带理由(related_reasons,TDD)

**Files:** Modify `src/note-generator.ts`(加 `related_reasons?` + renderNote 分支); Test `src/note-generator.test.ts`(加测试)

选区抽返回 `related: [{title, reason}]`,批处理返回 `related: string[]`。用 `related_reasons?` 让 renderNote 的 `## 关联` 在有理由时显示 `[[title]] — reason`,无理由时显示纯 `[[backlink]]`(向后兼容批处理笔记)。frontmatter `related:` 始终是标题列表(喂图谱)。

- [ ] **Step 1: 写失败测试** (加到 `src/note-generator.test.ts`):

```typescript
test("renderNote: 有 related_reasons → ## 关联 显示 [[title]] — reason", () => {
  const md = renderNote({
    title: "飞轮", summary: "s", source_pdf: "b.pdf", source_page: 3, source_text: "原文",
    tags: [], related: ["网络效应"], related_reasons: [{ title: "网络效应", reason: "都讲平台价值" }],
    model: "m", extraction_mode: "selection",
  }, "2026-07-27");
  assert.ok(md.includes("- [[网络效应]] — 都讲平台价值"));
  assert.ok(md.includes('  - "[[网络效应]]"'));  // frontmatter backlink 仍在
});

test("renderNote: 无 related_reasons(批处理)→ ## 关联 纯 backlink,向后兼容", () => {
  const md = renderNote({
    title: "飞轮", summary: "s", source_pdf: "b.pdf", source_page: 3, source_text: "原文",
    tags: [], related: ["网络效应", "好战略坏战略"], model: "m", extraction_mode: "batch",
  }, "2026-07-27");
  assert.ok(md.includes("- [[网络效应]]"));
  assert.ok(!md.includes("- [[网络效应]] — "));  // 无 reason 后缀
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/note-generator.test.ts` → FAIL(无 related_reasons 字段)

- [ ] **Step 3: 写最小实现** (改 `src/note-generator.ts`):

`KnowledgePoint` 加可选字段:
```typescript
export interface KnowledgePoint {
  title: string; summary: string;
  source_pdf: string;
  source_page: number;
  source_text: string;
  tags: string[];
  related: string[];                 // 标题列表(frontmatter backlink + 图谱)
  related_reasons?: { title: string; reason: string }[];  // 选区抽给的理由(body 用;批处理无)
  model: string;
  extraction_mode: "batch" | "selection";
}
```
renderNote 的 `## 关联` 分支(替换原来 `p.related.forEach(r => lines.push(\`- [[${r}]]\`))` 那行):
```typescript
  if (p.related.length) {
    lines.push("", "## 关联");
    if (p.related_reasons && p.related_reasons.length) {
      p.related_reasons.forEach(rr => lines.push(`- [[${rr.title}]]${rr.reason ? ` — ${rr.reason}` : ""}`));
    } else {
      p.related.forEach(r => lines.push(`- [[${r}]]`));
    }
  }
```
(注:`## 原文` 之后才到 `## 关联`;保持现有 lines.push 顺序,只替换关联块的渲染逻辑。)

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/note-generator.test.ts` → PASS(原 6 + 新 2 = 8)

- [ ] **Step 5: Commit**
```bash
git add src/note-generator.ts src/note-generator.test.ts
git commit -m "feat(shiyue): renderNote ## 关联 with related_reasons (plan3 task2)"
```
