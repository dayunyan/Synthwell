# 拾阅 — Plan B: 建工作区(原生 viewer + 图谱中枢 + AI 面板)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 退役 spike embed,改用 Obsidian 原生 PDF viewer 作预览;建 `preview/`+`workspace/`+`ui/` 模块,实现:图谱中枢右上角拾阅 logo → 点 → 右侧分两屏(上原生 PDF 预览 / 下拾阅 AI 面板)→ 右键文件列表「在拾阅中打开」加载文件 → AI 面板「抽取整篇知识点」「选区知识点提取」对预览文件操作,选区两触发共存(面板按钮 + 预览右键「深抽这个知识点」),无预览文件时按钮禁用。产出可人工验的完整工作区 v1。

**Architecture:** 全公开 API,零 monkey-patch。`preview/` 被动 DOM(选区捕获:mouseup 缓存 + contextmenu 深抽);`workspace/` 耦合 obsidian(分屏/AI 面板/file-menu/抽取胶水/preview-tracker);`ui/` 通用 Modal;`main.ts` 仅装配。`core/`(Plan A 已就绪)复用 BatchExtractor/SelectionExtractor/NoteGenerator/PdfDocumentSource。纯逻辑(`SelectionCache`/`PreviewTracker`)TDD;obsidian 耦合件人工验 + build clean + 现有 50 测试不回归。第一步验原生 viewer DOM 含 `[data-page-number]`(spec §5)。

**Tech Stack:** TypeScript、Obsidian 公开 API(ItemView/WorkspaceLeaf/Menu/FuzzySuggestModal/getLeaf('split',dir)/`workspace.on('file-menu')`/`workspace.on('layout-change')`/registerDomEvent)、node:test(`--experimental-strip-types`)、esbuild cjs。

**关联 spec:** `docs/superpowers/specs/2026-07-28-shiyue-workspace-design.md` §1(架构/组件表)+ §2(目录)+ §3(选区两触发)+ §4(复用/退役)+ §5(DOM 假设)+ §6(排序)。

---

## 关键事实(实现者必读)

1. **`pdf-worker.ts` 的 `configureWorker` 不能删**——`PdfDocumentSource.getDocument()`(批处理取文本 + 选区上下文都靠它)动态 `import("../../pdf-worker.ts")` 调它配 pdfjs worker。Plan B 把 `configureWorker` **移到** `src/core/document/pdf-worker-config.ts`,改 `PdfDocumentSource` 的 import 为 `./pdf-worker-config.ts`,再删根级 `pdf-worker.ts`。
2. **`copyPdfWorker` esbuild 插件保留**——它把 `pdf.worker.min.mjs` 拷到插件根,`configureWorker` 指向它;文件级重读仍需。只删 `patchPdfViewerVersionCheck`(spike embed 的 `pdf_viewer.mjs` 版本补丁,原生 viewer 不需要)。
3. **`styles.css` 6872 行,99% 是 `.shiyue-pdf-root` 作用域的 pdfjs viewer CSS**(由 `scripts/scope-pdfjs-css.mjs` 生成,服务 spike embed)。原生 viewer 自带 CSS → 全部废弃;Plan B 清空 styles.css 重写一份小的(confirm 按钮 + AI 面板 + logo),并删 `scripts/scope-pdfjs-css.mjs`。
4. **`PdfDocumentSource` 已有 `getDocument(): Promise<PDFDocumentProxy|null>`**(document-source.ts:25)——选区上下文 ±2 页直接 `source.getDocument()` → `getPage(p)` → `getTextContent()` → `pageTextFromItems`。无需改 document-source 的 API,只改它的 `configureWorker` import 路径。
5. **`SelectionExtractor.extract(book, selected, page, contextText, existingTitles)`** 签名不变(selection-extractor.ts:49);`BatchExtractor.extract(source, {onProgress})` 返回 `ExtractResult{count,chunks,cancelled,message}`(batch-extractor.ts:119)。extraction-controller 组装这些,逻辑与 main.ts 现有 `extractCurrentPdf`/`extractSelection` 同(只把数据源从 `view` 换成 `tracker.file` + `cache` + `PdfDocumentSource(file)`)。
6. **`app.secretStorage.getSecret("shiyue-api-key")`**——main.ts:89 现有用法是同步取值 `?? ""`(Plan 2 验证可工作)。extraction-controller **原样照搬**这一行,不要改写(改了可能引入回归)。
7. `main.ts` 现有 `confirmCost`(Modal,L142)+ `PdfPickerModal`(FuzzySuggestModal,L160)在 Plan B 迁移:`confirmCost` → `ui/confirm-modal.ts`;`PdfPickerModal` 并入 `workspace/shiyue-workspace.ts`(只工作区用)。

---

## 文件结构

**新建:**
| 文件 | 职责 | 验证 |
|---|---|---|
| `src/preview/selection-capture.ts` | `SelectionCache`(TDD)+ `findPageNumber(el)`(DOM 祖先找 `[data-page-number]`)+ `attachSelectionCapture(leaf, cache, {onDeepExtract})`(mouseup→cache + contextmenu→Menu「深抽」) | cache TDD;attach/findPageNumber 人工验 |
| `src/workspace/preview-tracker.ts` | `PreviewTracker`:持 `currentFile` + `onChange` 通知(供 AI 面板按钮启用/禁用) | TDD |
| `src/workspace/extraction-controller.ts` | `ExtractionController.extractBatch(file)`/`extractSelection(file, sel|null)`(胶水:build provider+noteGen+state+batch/selection extractor,调 core/extraction) | 人工验(LLM) |
| `src/workspace/shiyue-workspace.ts` | `ensureShiyueSplit()`/`openInShiyue(file)`/`openInShiyuePicker()`/`injectLogo()`;持 previewLeaf/aiLeaf/tracker/cache/controller;实现 `PanelActions` 接口供面板调 | 人工验 |
| `src/workspace/ai-panel-view.ts` | `AiPanelView` ItemView(`SHIYUE_AI_PANEL_VIEW`):两按钮 + 聊天留位;按 `PanelActions` 启用/禁用按钮 | 人工验 |
| `src/workspace/file-menu.ts` | `registerFileMenu(plugin)`:`workspace.on('file-menu')` 给 `.pdf` 加「在拾阅中打开」→ `openInShiyue` | 人工验 |
| `src/ui/confirm-modal.ts` | `confirmCost(app, {book,chunks,tokens,cost}): Promise<boolean>`(从 main.ts 抽出) | 人工验 |
| `src/core/document/pdf-worker-config.ts` | `configureWorker(app, plugin)`(从 `pdf-worker.ts` 移来) | build clean |

**修改:**
| 文件 | 改动 |
|---|---|
| `src/core/document/document-source.ts` | import 路径 `../../pdf-worker.ts` → `./pdf-worker-config.ts` |
| `src/main.ts` | 装配新 workspace + `registerView(SHIYUE_AI_PANEL_VIEW)` + file-menu + 命令改指 workspace;删 `registerView(SHIYUE_PDF_VIEW)`/`openPdf`/`extractCurrentPdf`/`extractSelection`/`confirmCost`/`PdfPickerModal`/spike import |
| `esbuild.config.mjs` | 删 `patchPdfViewerVersionCheck` 插件(+ 其 onLoad 逻辑);`plugins: [copyPdfWorker]` |
| `styles.css` | 清空 6872 行,重写小的(confirm-btns + ai-panel + logo) |

**删除(退役 spike):**
- `src/pdf-view.ts`(spike PdfView embed)
- `src/pdfjs-version-shim.ts`(spike 版本 shim;删前 grep 确认无 retained importer)
- `src/pdf-worker.ts`(其内容已移到 `core/document/pdf-worker-config.ts`)
- `scripts/scope-pdfjs-css.mjs`(spike 作用域 CSS 生成器)

**保留(误删警告):** `esbuild.config.mjs` 的 `copyPdfWorker` 插件 + 产物 `pdf.worker.min.mjs`(文件级重读需要)。

---

### Task 1: 验 spec §5 DOM 假设(人工 gate,无代码)

**目的:** 确认原生 PDF view 的 `contentEl` 内含 `[data-page-number]` 元素(pdfjs 标准),选区页码定位靠它。`findPageNumber`(Task 2)按它写。

- [ ] **Step 1: 测试 vault 打开一个原生 PDF** — Obsidian 里点一个 `.pdf` 文件(用原生 viewer,不是 spike)。开 DevTools(Cmd+Opt+I)。

- [ ] **Step 2: console 跑这段,确认输出**
```js
const leaf = app.workspace.getLeavesOfType('pdf')[0];
const root = leaf?.view?.contentEl;
const page = root?.querySelector('[data-page-number]');
console.log({ hasLeaf: !!leaf, hasRoot: !!root, hasPage: !!page, pageNumber: page?.dataset?.pageNumber });
```
**期望:** `{ hasLeaf: true, hasRoot: true, hasPage: true, pageNumber: "1" }`。

- [ ] **Step 3: 验选中后锚点能爬到 page 元素** — 在 PDF 里用鼠标选中一段文字,再跑:
```js
const s = getSelection();
let n = s.anchorNode; const trail = [];
while (n && !(n.dataset?.pageNumber)) { trail.push(n.nodeName); n = n.parentElement; }
console.log({ foundPage: n?.dataset?.pageNumber, trail });
```
**期望:** `foundPage` 为页码字符串(`"1"` 等)。

- [ ] **Step 4: 记录结果** — 在 plan 文件 Task 1 下方补一行 `> 验证结果(YYYY-MM-DD):…`。若 `hasPage=false`:Task 2 的 `findPageNumber` 改用更宽选择器(遍历祖先时,任一祖先的 `dataset.pageNumber` / 或 `.closest('.page,[data-page-number]')`),并 fallback `page=1`(记为已知限制,不阻塞)。

- [ ] **Step 5: 不 commit**(本任务无代码改动;结果写回 plan 即可,plan 本身的 commit 在最后)。

---

### Task 2: `preview/selection-capture.ts`(`SelectionCache` TDD + `findPageNumber` + `attachSelectionCapture`)

**Files:**
- Create: `src/preview/selection-capture.ts`
- Create: `src/preview/selection-capture.test.ts`(仅 `SelectionCache` 单测;DOM 件人工验)

- [ ] **Step 1: 写 `SelectionCache` 的失败测试**
```typescript
// src/preview/selection-capture.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SelectionCache } from "./selection-capture.ts";

test("SelectionCache: 初始 get 为 null", () => {
  const c = new SelectionCache();
  assert.equal(c.get(), null);
});

test("SelectionCache: set 后 get 返回该值", () => {
  const c = new SelectionCache();
  c.set({ text: "hi", page: 3 });
  assert.deepEqual(c.get(), { text: "hi", page: 3 });
});

test("SelectionCache: 多次 set 返回最新", () => {
  const c = new SelectionCache();
  c.set({ text: "a", page: 1 }); c.set({ text: "b", page: 2 });
  assert.equal(c.get()?.text, "b");
});

test("SelectionCache: clear 后 get 为 null", () => {
  const c = new SelectionCache();
  c.set({ text: "a", page: 1 }); c.clear();
  assert.equal(c.get(), null);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/preview/selection-capture.test.ts` → FAIL(模块找不到 `./selection-capture.ts`)。

- [ ] **Step 3: 写实现**
```typescript
// src/preview/selection-capture.ts
import type { WorkspaceLeaf, Menu } from "obsidian";
import { Menu as ObsMenu } from "obsidian";

export interface SelInfo { text: string; page: number; }

/** 选区缓存:mouseup 时写,{button / 右键深抽}时读。纯值对象,可单测。 */
export class SelectionCache {
  private sel: SelInfo | null = null;
  get(): SelInfo | null { return this.sel; }
  set(sel: SelInfo): void { this.sel = sel; }
  clear(): void { this.sel = null; }
}

/** 从选区锚点向上找页码:遍历祖先取 `dataset.pageNumber`(pdfjs `.page[data-page-number]` 有此属性)。
 *  找不到返回 null(调用方 fallback 1)。DOM 件,人工验(Task 1 已确认选择器)。 */
export function findPageNumber(el: Element | null): number | null {
  let node: Element | null = el;
  while (node) {
    const pn = (node as HTMLElement).dataset?.pageNumber;
    if (pn) { const n = Number(pn); return Number.isFinite(n) ? n : null; }
    node = node.parentElement;
  }
  return null;
}

export interface AttachOpts { onDeepExtract?: () => void; }

/** 给预览 leaf 的 contentEl 挂两个被动 DOM 监听(零 monkey-patch):
 *  - mouseup:window.getSelection 取文本 + findPageNumber 定位页 → cache.set/clear
 *  - contextmenu:有缓存选区时,弹 Obsidian Menu「深抽这个知识点」→ onDeepExtract
 *  返回 cleanup(摘除两个 listener)。 */
export function attachSelectionCapture(leaf: WorkspaceLeaf, cache: SelectionCache, opts: AttachOpts = {}): () => void {
  const root = leaf.view?.contentEl;
  if (!root) return () => {};

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!text) { cache.clear(); return; }
    const anchor = sel?.anchorNode;
    const startEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    const page = findPageNumber(startEl) ?? 1;  // fallback 1(Task 1 不成立时)
    cache.set({ text, page });
  };

  const onContextMenu = (ev: MouseEvent) => {
    const sel = cache.get();
    if (!sel || !opts.onDeepExtract) return;  // 无选区/无回调 → 让原生菜单通过
    ev.preventDefault();
    ev.stopPropagation();
    const menu = new ObsMenu();
    menu.addItem((i) => i.setTitle("深抽这个知识点").onClick(() => opts.onDeepExtract!()));
    menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
  };

  root.addEventListener("mouseup", onMouseUp);
  root.addEventListener("contextmenu", onContextMenu);
  return () => {
    root.removeEventListener("mouseup", onMouseUp);
    root.removeEventListener("contextmenu", onContextMenu);
  };
}

// 引 Menu 类型避免 unused(实际 new ObsMenu() 已用)。保留 import type 供未来扩展。
export type { Menu };
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/preview/selection-capture.test.ts` → 4 pass。

- [ ] **Step 5: build** — `npm run build` → clean(`pdfjs-dist`、`obsidian` external;`WorkspaceLeaf`/`Menu` 仅类型 + `new ObsMenu()` 运行时,无 module not found)。

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(shiyue): preview/selection-capture (SelectionCache TDD + attachSelectionCapture) (plan-b task2)"
```

---

### Task 3: `workspace/preview-tracker.ts`(`PreviewTracker` TDD)

**Files:**
- Create: `src/workspace/preview-tracker.ts`
- Create: `src/workspace/preview-tracker.test.ts`

- [ ] **Step 1: 写失败测试**
```typescript
// src/workspace/preview-tracker.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewTracker } from "./preview-tracker.ts";

test("PreviewTracker: 初始 get 为 null", () => {
  assert.equal(new PreviewTracker().get(), null);
});

test("PreviewTracker: set 后 get 返回该文件对象", () => {
  const t = new PreviewTracker();
  const f = { path: "x.pdf" } as any;
  t.set(f);
  assert.equal(t.get(), f);
});

test("PreviewTracker: onChange 注册时立即回调当前值", () => {
  const t = new PreviewTracker();
  t.set({ path: "a" } as any);
  let seen: any = "init";
  t.onChange((f) => { seen = f; });
  assert.equal(seen?.path, "a");
});

test("PreviewTracker: set 触发所有 listener", () => {
  const t = new PreviewTracker();
  const seen: any[] = [];
  t.onChange((f) => seen.push(f));
  t.set({ path: "b" } as any);
  assert.equal(seen.at(-1)?.path, "b");
});

test("PreviewTracker: onChange 返回的取消订阅生效", () => {
  const t = new PreviewTracker();
  const seen: any[] = [];
  const off = t.onChange((f) => seen.push(f));
  off();
  t.set({ path: "c" } as any);
  // 取消后不应再推(初始那次 onChange 已 push 过 null,这里只看 set 不再推)
  assert.equal(seen.find((f) => f && f.path === "c"), undefined);
});
```

- [ ] **Step 2: 跑确认失败** — `node --test --experimental-strip-types src/workspace/preview-tracker.test.ts` → FAIL。

- [ ] **Step 3: 写实现**
```typescript
// src/workspace/preview-tracker.ts
import type { TFile } from "obsidian";

/** 跟踪当前预览 leaf 打开的文件。openInShiyue 时 set;AI 面板 onChange 启用/禁用按钮。
 *  纯值持有 + 观察者,可单测(不耦合 obsidian leaf 生命周期——leaf 有效性由 ShiyueWorkspace 校验)。 */
export class PreviewTracker {
  private file: TFile | null = null;
  private listeners = new Set<(f: TFile | null) => void>();

  get(): TFile | null { return this.file; }

  set(file: TFile | null): void {
    this.file = file;
    for (const fn of this.listeners) fn(file);
  }

  /** 注册监听;立即回调当前值。返回取消订阅。 */
  onChange(fn: (f: TFile | null) => void): () => void {
    this.listeners.add(fn);
    fn(this.file);
    return () => { this.listeners.delete(fn); };
  }
}
```

- [ ] **Step 4: 跑确认通过** — `node --test --experimental-strip-types src/workspace/preview-tracker.test.ts` → 5 pass。

- [ ] **Step 5: build** — `npm run build` → clean。

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(shiyue): workspace/preview-tracker (PreviewTracker TDD) (plan-b task3)"
```

---

### Task 4: `ui/confirm-modal.ts`(抽 `confirmCost`,人工验)

**Files:**
- Create: `src/ui/confirm-modal.ts`
- Modify: `src/main.ts`(暂留 `confirmCost` 本体直到 Task 9 删;本任务只新建 ui 文件,不改 main.ts——避免中间态 main.ts 引用未对齐)

- [ ] **Step 1: 写实现**(从 main.ts:142-157 原样搬,改成独立函数 + 传入 app)
```typescript
// src/ui/confirm-modal.ts
import { App, Modal } from "obsidian";

export interface CostInfo { book: string; chunks: number; tokens: number; cost: number; }

/** 预估花费弹窗:点「继续」返回 true,关闭/取消/Esc 返回 false。
 *  从 main.ts 抽出(Task 9 extraction-controller 复用)。 */
export function confirmCost(app: App, info: CostInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new Modal(app);
    m.titleEl.setText("抽取知识点 — 预估花费");
    m.contentEl.createEl("p", { text: `《${info.book}》:约 ${info.chunks} 块 / ${info.tokens} tokens,预计 ¥${info.cost.toFixed(3)}。继续?` });
    const btns = m.contentEl.createDiv({ cls: "shiyue-confirm-btns" });
    const yes = btns.createEl("button", { text: "继续" });
    const no = btns.createEl("button", { text: "取消" });
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; m.close(); resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    m.onClose = () => done(false);
    m.open();
  });
}
```

- [ ] **Step 2: build** — `npm run build` → clean(新文件未引用,treeShaking 会剔,但 tsc 仍编译)。

- [ ] **Step 3: 不跑测试**(纯 UI Modal,人工验留到 Task 9 装配后整体验)。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(shiyue): ui/confirm-modal (extract confirmCost from main.ts) (plan-b task4)"
```

---

### Task 5: `workspace/extraction-controller.ts` + 移 `configureWorker` → `core/document/pdf-worker-config.ts`

**Files:**
- Create: `src/core/document/pdf-worker-config.ts`(从 `pdf-worker.ts` 搬 `configureWorker`)
- Modify: `src/core/document/document-source.ts`(import 路径)
- Create: `src/workspace/extraction-controller.ts`

- [ ] **Step 1: 建 `pdf-worker-config.ts`** — 把 `src/pdf-worker.ts` 的 `configureWorker` 原样搬来(函数体不变;注释精简):
```typescript
// src/core/document/pdf-worker-config.ts
import { App, normalizePath, Plugin } from "obsidian";
import { GlobalWorkerOptions, version } from "pdfjs-dist";

/** 配置 pdfjs worker(off-main-thread)。worker 文件 `pdf.worker.min.mjs` 由 esbuild
 *  `copyPdfWorker` 插件拷到插件根,served via app:// resource URL。pdfjs v6 worker 只出 ESM,
 *  pdfjs 自行 new Worker(workerSrc,{type:"module"}) + 处理 app:// 跨源 blob 包裹。
 *  从根级 pdf-worker.ts 移入 core/document/(Plan B:spike 退役,但文件级重读仍需此函数)。 */
export function configureWorker(app: App, plugin: Plugin): void {
  const workerFile = "pdf.worker.min.mjs";
  const dir = plugin.manifest.dir ?? "";
  const workerPath = normalizePath(dir ? `${dir}/${workerFile}` : workerFile);
  const workerSrc = app.vault.adapter.getResourcePath(workerPath);
  GlobalWorkerOptions.workerSrc = workerSrc;
  console.info(`[shiyue] pdfjs ${version}: workerSrc = ${workerSrc}`);
}
```

- [ ] **Step 2: 改 `document-source.ts` import** — 把第 29 行 `const { configureWorker } = await import("../../pdf-worker.ts");` 改成 `await import("./pdf-worker-config.ts");`(同 folder)。其余不变。

```typescript
// src/core/document/document-source.ts(getDocument 内,只改这行)
const { configureWorker } = await import("./pdf-worker-config.ts");
```

- [ ] **Step 3: 建 `extraction-controller.ts`** — 把 main.ts:87-139 的 `extractCurrentPdf`/`extractSelection` 逻辑搬来,数据源从 `view` 换成 `file` + `sel` + `PdfDocumentSource(file)`。**apiKey 行原样照搬**(spec 关键事实 #6)。
```typescript
// src/workspace/extraction-controller.ts
import { App, Plugin, TFile, Notice } from "obsidian";
import { OpenAICompatibleProvider } from "../core/llm/llm-service.ts";
import { PdfDocumentSource } from "../core/document/document-source.ts";
import { NoteGenerator } from "../core/extraction/note-generator.ts";
import { ExtractionState } from "../core/extraction/extraction-state.ts";
import { BatchExtractor } from "../core/extraction/batch-extractor.ts";
import { SelectionExtractor } from "../core/extraction/selection-extractor.ts";
import { pageTextFromItems } from "../core/document/pdf-text.ts";
import { confirmCost } from "../ui/confirm-modal.ts";
import type { ShiyueSettings } from "../../settings.ts";
import type { SelInfo } from "../preview/selection-capture.ts";

/** 抽取胶水:build provider/noteGen/state,调 core/extraction。从 main.ts 抽出。
 *  数据源:batch 用 PdfDocumentSource(file) file 级重读;selection 上下文同源(±2 页)。
 *  逻辑与 main.ts 现有方法同(只是 file/sel 从 workspace 拿,不再依赖 spike PdfView)。 */
export class ExtractionController {
  constructor(private app: App, private plugin: Plugin, private settings: () => ShiyueSettings) {}

  /** 整篇批处理:取文本→分块→预估确认→map 去重→生成笔记。 */
  async extractBatch(file: TFile): Promise<void> {
    const s = this.settings();
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";  // 原样(Plan 2 验证可工作)
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey: apiKey as string, model: s.model });
    const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
    const pricing = s.pricing.find(p => p.model === s.model) ?? s.pricing[0];
    const state = new ExtractionState(this.app.vault.adapter as any);
    const be = new BatchExtractor(this.app, provider, noteGen, { notesPath: s.notesPath, model: s.model }, pricing, (book, chunks, tokens, cost) => confirmCost(this.app, { book, chunks, tokens, cost }), state);
    const source = new PdfDocumentSource(file, this.app, this.plugin);
    new Notice("抽取中…(大 PDF 可能需要几十秒)", 4000);
    const r = await be.extract(source, { onProgress: (d, t, p) => new Notice(`抽取中 ${d}/${t} → ${p} 点`, 2000) });
    if (r.count > 0) new Notice(`✓ ${r.message}:${r.count} 个知识点(见 ${s.notesPath}/)`, 8000);
    else new Notice(`✗ ${r.message}`, 8000);
  }

  /** 选区深抽:选中段 + 上下文 ±2 页 + 已有标题 → AI 抽单点 → 生成笔记 + 打开。 */
  async extractSelection(file: TFile, sel: SelInfo): Promise<void> {
    const s = this.settings();
    const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
    if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
    const provider = new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey: apiKey as string, model: s.model });
    const source = new PdfDocumentSource(file, this.app, this.plugin);
    const doc = await source.getDocument();
    if (!doc) { new Notice("PDF 未加载完成"); return; }
    try {
      const contextPages: string[] = [];
      for (let pg = Math.max(1, sel.page - 2); pg <= Math.min(doc.numPages, sel.page + 2); pg++) {
        const p = await doc.getPage(pg);
        const tc = await p.getTextContent();
        contextPages.push(`第${pg}页:${pageTextFromItems(tc.items.map((it: any) => ({ str: it.str ?? "" })))}`);
      }
      const existing = this.app.vault.getFiles()
        .filter(f => f.path.startsWith(s.notesPath) && f.extension === "md")
        .map(f => f.basename).slice(0, 500);
      new Notice("深抽中…", 2000);
      const se = new SelectionExtractor(provider);
      const point = await se.extract(file.basename, sel.text, sel.page, contextPages.join("\n"), existing);
      if (!point) { new Notice("未能抽取(模型未返回有效结果)", 4000); return; }
      const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
      const path = await noteGen.generate({
        title: point.title, summary: point.summary, source_pdf: file.basename, source_page: point.source_page,
        source_text: sel.text, tags: point.tags, related: point.related.map(r => r.title), related_reasons: point.related,
        model: s.model, extraction_mode: "selection",
      });
      new Notice(`✓ 已生成:${point.title}`, 4000);
      const nf = this.app.vault.getAbstractFileByPath(path);
      if (nf instanceof TFile) await this.app.workspace.getLeaf().openFile(nf);
    } finally {
      await doc.destroy?.();
    }
  }
}
```

- [ ] **Step 4: build** — `npm run build` → clean。document-source 改了 import;extraction-controller 引 `../../settings.ts`(根)+ `../preview/...` + `../core/...` + `../ui/...`——tsc 报 module not found 就修(应无)。

- [ ] **Step 5: 跑现有测试不回归** — `node --test --experimental-strip-types $(find src -name '*.test.ts')` → 50/50(document-source.test 若 mock 了 `../../pdf-worker.ts` 路径需同步改 `./pdf-worker-config.ts`;若有失败,改测试里的 import map)。

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(shiyue): move configureWorker→core/document/pdf-worker-config + workspace/extraction-controller (plan-b task5)"
```

---

### Task 6: `workspace/shiyue-workspace.ts`(分屏 + openInShiyue + logo + PanelActions)

**Files:**
- Create: `src/workspace/shiyue-workspace.ts`

**依赖:** Task 2(selection-capture)、Task 3(PreviewTracker)、Task 5(ExtractionController)。`aiViewType` 由 main.ts 注入(避免 workspace→ai-panel-view 运行时循环)。

- [ ] **Step 1: 写实现**
```typescript
// src/workspace/shiyue-workspace.ts
import { App, Plugin, TFile, FuzzySuggestModal, Notice, WorkspaceLeaf } from "obsidian";
import { SelectionCache, SelInfo, attachSelectionCapture } from "../preview/selection-capture.ts";
import { PreviewTracker } from "./preview-tracker.ts";
import { ExtractionController } from "./extraction-controller.ts";
import type { ShiyueSettings } from "../../settings.ts";

/** AI 面板调工作区的动作接口(type-only,AiPanelView 引此避免运行时循环)。
 *  未来 Agent 也可实现此接口驱动面板。 */
export interface PanelActions {
  getCurrentFile(): TFile | null;
  getCurrentSelection(): SelInfo | null;
  onFileChange(fn: (f: TFile | null) => void): () => void;
  extractBatch(): Promise<void>;
  extractSelection(): Promise<void>;
}

export const SHIYUE_LOGO_ATTR = "data-shiyue-logo";

/** 拾阅工作区:右侧分屏(上原生预览 / 下 AI 面板)+ logo 注入 + file 加载 + 选区捕获接线。
 *  全公开 API,零 monkey-patch;被动 DOM 监听。 */
export class ShiyueWorkspace implements PanelActions {
  private app: App;
  private plugin: Plugin;
  private settings: () => ShiyueSettings;
  private aiViewType: string;
  private tracker = new PreviewTracker();
  private cache = new SelectionCache();
  private controller: ExtractionController;
  private previewLeaf: WorkspaceLeaf | null = null;
  private aiLeaf: WorkspaceLeaf | null = null;
  private detachCapture: (() => void) | null = null;

  constructor(app: App, plugin: Plugin, settings: () => ShiyueSettings, aiViewType: string) {
    this.app = app; this.plugin = plugin; this.settings = settings; this.aiViewType = aiViewType;
    this.controller = new ExtractionController(app, plugin, settings);
  }

  // ---- PanelActions ----
  getCurrentFile(): TFile | null { return this.tracker.get(); }
  getCurrentSelection(): SelInfo | null { return this.cache.get(); }
  onFileChange(fn: (f: TFile | null) => void): () => void { return this.tracker.onChange(fn); }

  async extractBatch(): Promise<void> {
    const file = this.tracker.get();
    if (!file) { new Notice("没有打开的 PDF"); return; }
    await this.controller.extractBatch(file);
  }

  async extractSelection(): Promise<void> {
    const file = this.tracker.get();
    if (!file) { new Notice("没有打开的 PDF"); return; }
    const sel = this.cache.get();
    if (!sel) { new Notice("请先在 PDF 中选中一段文字", 4000); return; }
    await this.controller.extractSelection(file, sel);
  }

  // ---- 分屏 ----
  /** 确保右侧分屏存在(上 preview / 下 ai)。幂等:已存在则聚焦,preview 失效则重建。 */
  async ensureShiyueSplit(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    if (existingAi) {
      this.aiLeaf = existingAi;
      this.app.workspace.setActiveLeaf(existingAi, { focus: true });
      if (!this.isPreviewLeafValid()) await this.recreatePreviewLeaf(existingAi);
      return;
    }
    // 首次:active leaf(graph)向右分屏 → previewLeaf;再向下分屏 → aiLeaf
    const preview = this.app.workspace.getLeaf("split", "right") as WorkspaceLeaf;
    this.previewLeaf = preview;
    this.app.workspace.setActiveLeaf(preview, { focus: false });
    const ai = this.app.workspace.getLeaf("split", "down") as WorkspaceLeaf;
    await ai.setViewState({ type: this.aiViewType, state: {} });
    this.aiLeaf = ai;
    // preview 尚无文件,不挂选区捕获(等 openInShiyue 的 openFile 后 view 稳定再挂)
  }

  private isPreviewLeafValid(): boolean {
    return !!this.previewLeaf && this.app.workspace.getLeaves().includes(this.previewLeaf);
  }

  /** ai 在但 preview 被关:从 ai 向上分屏重建 preview。 */
  private async recreatePreviewLeaf(ai: WorkspaceLeaf): Promise<void> {
    this.app.workspace.setActiveLeaf(ai, { focus: false });
    this.previewLeaf = this.app.workspace.getLeaf("split", "up") as WorkspaceLeaf;
  }

  // ---- 加载文件 ----
  /** 确保 split + 原生预览打开 file + 重挂选区捕获 + tracker.set → 按钮启用。 */
  async openInShiyue(file: TFile): Promise<void> {
    await this.ensureShiyueSplit();
    const leaf = this.previewLeaf;
    if (!leaf) { new Notice("无法创建预览面板"); return; }
    await leaf.openFile(file);  // 走原生 'pdf' 路由
    this.attachPreviewCapture();  // view 换了,重挂
    this.tracker.set(file);
  }

  /** 给 preview leaf 的 contentEl 挂 mouseup(→cache)+ contextmenu(→深抽 Menu)。 */
  private attachPreviewCapture(): void {
    this.detachCapture?.();
    this.detachCapture = null;
    const leaf = this.previewLeaf;
    if (!leaf?.view?.contentEl) return;
    this.detachCapture = attachSelectionCapture(leaf, this.cache, {
      onDeepExtract: () => { void this.extractSelection(); },
    });
  }

  // ---- logo 注入(被动 DOM,在 graph view contentEl 右上角加 📖)----
  /** 注册 layout-change 监听 + 立即扫一次。plugin.registerEvent 管自动 cleanup。 */
  registerLogoInjector(): void {
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.injectLogos()));
    this.injectLogos();
  }

  private injectLogos(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
      const content = (leaf.view as any).contentEl as HTMLElement | undefined;
      if (!content || content.querySelector(`[${SHIYUE_LOGO_ATTR}]`)) continue;
      const btn = content.createEl("div", { attr: { [SHIYUE_LOGO_ATTR]: "" }, cls: "shiyue-logo" });
      btn.setText("📖");
      btn.onclick = () => { void this.ensureShiyueSplit(); };
    }
  }

  // ---- picker ----
  async openInShiyuePicker(): Promise<void> {
    const pdfs = this.app.vault.getFiles().filter(f => f.extension === "pdf");
    if (pdfs.length === 0) { new Notice("vault 中没有 .pdf 文件"); return; }
    const picker = new ShiyuePdfPickerModal(this.app, pdfs, (f) => { void this.openInShiyue(f); });
    picker.open();
  }

  /** 卸载时摘监听(main.ts onunload 调)。 */
  destroy(): void { this.detachCapture?.(); this.detachCapture = null; }
}

class ShiyuePdfPickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, items: TFile[], private onChoose: (f: TFile) => void) {
    super(app);
    this.setTitle("选择要在拾阅中打开的 PDF").setPlaceholder("搜索文件名…");
  }
  getItems(): TFile[] { return (this as any).items as TFile[]; }
  getItemText(item: TFile): string { return item.basename; }
  onChooseItem(item: TFile): void { this.onChoose(item); }
}
```

- [ ] **Step 2: build** — `npm run build` → clean(`FuzzySuggestModal`/`WorkspaceLeaf`/`getLeaf` 均公开;类型循环已用 `type` 消除)。

- [ ] **Step 3: 人工验(留到 Task 9 装配后整体验)** — 本任务只 build clean + commit。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(shiyue): workspace/shiyue-workspace (ensureSplit + openInShiyue + logo + picker) (plan-b task6)"
```

> **实现者注:** `ShiyuePdfPickerModal.getItems` 里 `(this as any).items` 是因为 `FuzzySuggestModal` 基类没暴露我们构造存的 `items` 字段;若 tsc 允许 `private readonly items` 字段直接用,就去掉 `(this as any)` 直接 `this.items`——以 build clean 为准。

---

### Task 7: `workspace/ai-panel-view.ts`(`AiPanelView` ItemView + 两按钮 + 聊天留位)

**Files:**
- Create: `src/workspace/ai-panel-view.ts`

**依赖:** Task 6(`PanelActions` type)。

- [ ] **Step 1: 写实现**
```typescript
// src/workspace/ai-panel-view.ts
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { PanelActions } from "./shiyue-workspace.ts";

export const SHIYUE_AI_PANEL_VIEW = "shiyue-ai-panel";

/** 拾阅 AI 面板:两按钮(抽取整篇 / 选区知识点提取)+ 聊天留位。
 *  按钮启用/禁用跟踪预览文件(经 PanelActions.onFileChange)。 */
export class AiPanelView extends ItemView {
  private actions: PanelActions;
  private batchBtn?: HTMLButtonElement;
  private selBtn?: HTMLButtonElement;
  private detachFile: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, actions: PanelActions) {
    super(leaf);
    this.actions = actions;
  }

  getViewType(): string { return SHIYUE_AI_PANEL_VIEW; }
  getDisplayText(): string { return "拾阅 AI 面板"; }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("shiyue-ai-panel");

    const btns = c.createDiv({ cls: "shiyue-ai-actions" });
    this.batchBtn = btns.createEl("button", { text: "抽取整篇知识点" });
    this.selBtn = btns.createEl("button", { text: "选区知识点提取" });

    const onErr = (label: string) => (e: unknown) =>
      new Notice(`${label}:${e instanceof Error ? e.message : String(e)}`, 8000);
    this.batchBtn.onclick = () => { void this.actions.extractBatch().catch(onErr("抽取失败")); };
    this.selBtn.onclick = () => { void this.actions.extractSelection().catch(onErr("深抽失败")); };

    c.createDiv({ cls: "shiyue-ai-chat-placeholder" })
      .createEl("p", { text: "聊天 Agent(待实现)" });

    const sync = (f: import("obsidian").TFile | null) => {
      const has = !!f;
      if (this.batchBtn) this.batchBtn.disabled = !has;
      if (this.selBtn) this.selBtn.disabled = !has;  // 有文件即启用;无选区时点击给 Notice
    };
    this.detachFile = this.actions.onFileChange(sync);
  }

  async onClose(): Promise<void> { this.detachFile?.(); this.detachFile = null; }
}
```

- [ ] **Step 2: build** — `npm run build` → clean(`type { PanelActions }` type-only,无运行时循环)。

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(shiyue): workspace/ai-panel-view (AiPanelView ItemView + buttons + chat placeholder) (plan-b task7)"
```

---

### Task 8: `workspace/file-menu.ts`(file-menu hook「在拾阅中打开」)

**Files:**
- Create: `src/workspace/file-menu.ts`

- [ ] **Step 1: 写实现**
```typescript
// src/workspace/file-menu.ts
import { Plugin, TFile } from "obsidian";
import type { ShiyueWorkspace } from "./shiyue-workspace.ts";

/** 注册 file-menu hook:给 .pdf 文件加「在拾阅中打开」→ workspace.openInShiyue。
 *  公开 API(obsidian.d.ts 的 workspace.on('file-menu', (menu, file, source, leaf)))。 */
export function registerFileMenu(plugin: Plugin, workspace: ShiyueWorkspace): void {
  plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
    if (!(file instanceof TFile) || file.extension !== "pdf") return;
    menu.addItem((i) => {
      i.setTitle("在拾阅中打开").setIcon("book-open").onClick(() => { void workspace.openInShiyue(file); });
    });
  }));
}
```

- [ ] **Step 2: build** — `npm run build` → clean。

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(shiyue): workspace/file-menu (在拾阅中打开 hook) (plan-b task8)"
```

---

### Task 9: 重写 `main.ts`(装配 workspace + ai panel + file-menu + 命令;摘 spike PdfView)

**Files:**
- Modify: `src/main.ts`(整文件重写为装配层)

- [ ] **Step 1: 重写 main.ts** — 删 spike `PdfView`/`SHIYUE_PDF_VIEW` import + `registerView(SHIYUE_PDF_VIEW)` + `openPdf` + `extractCurrentPdf` + `extractSelection` + `confirmCost` + `PdfPickerModal`;改成装配新 workspace:
```typescript
// src/main.ts
import { Plugin } from "obsidian";
import { ShiyueSettings, DEFAULT_SETTINGS } from "./settings";
import { ShiyueSettingTab } from "./settings-tab";
import { UsageTracker } from "./core/llm/usage";
import { ShiyueWorkspace } from "./workspace/shiyue-workspace";
import { AiPanelView, SHIYUE_AI_PANEL_VIEW } from "./workspace/ai-panel-view";
import { registerFileMenu } from "./workspace/file-menu";

export default class ShiyuePlugin extends Plugin {
  settings: ShiyueSettings = DEFAULT_SETTINGS;
  private workspace!: ShiyueWorkspace;

  async onload() {
    await this.loadSettings();

    // 先建 workspace(registerView 的 factory 闭包要拿到 this.workspace)
    this.workspace = new ShiyueWorkspace(this.app, this, () => this.settings, SHIYUE_AI_PANEL_VIEW);

    this.registerView(SHIYUE_AI_PANEL_VIEW, (leaf) => new AiPanelView(leaf, this.workspace));
    this.workspace.registerLogoInjector();
    registerFileMenu(this, this.workspace);

    this.addCommand({
      id: "open-in-shiyue",
      name: "拾阅: 在拾阅中打开 PDF",
      callback: () => { void this.workspace.openInShiyuePicker(); },
    });
    this.addCommand({
      id: "extract-batch",
      name: "拾阅: 抽取整篇知识点(当前预览)",
      checkCallback: (checking) => this.batchCommand(checking),
    });
    this.addCommand({
      id: "extract-selection",
      name: "拾阅: 选区知识点提取(当前预览)",
      checkCallback: (checking) => this.selectionCommand(checking),
    });

    this.addSettingTab(new ShiyueSettingTab(this.app, this, new UsageTracker(this.app.vault.adapter as any)));
  }

  async onunload() {
    this.workspace?.destroy();
    this.app.workspace.detachLeavesOfType(SHIYUE_AI_PANEL_VIEW);
  }

  private batchCommand(checking: boolean): boolean | void {
    if (!this.workspace.getCurrentFile()) return false;
    if (checking) return true;
    void this.workspace.extractBatch();
  }

  private selectionCommand(checking: boolean): boolean | void {
    if (!this.workspace.getCurrentFile() || !this.workspace.getCurrentSelection()) return false;
    if (checking) return true;
    void this.workspace.extractSelection();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 2: build** — `npm run build` → clean。此刻 main.ts 不再 import spike `pdf-view`,但 `pdf-view.ts` 文件还在(下任务删);build 不报错(tree-shaking 剔除未引的 spike)。

- [ ] **Step 3: 跑全量测试不回归** — `node --test --experimental-strip-types $(find src -name '*.test.ts')` → 50/50(main.ts 改动不碰测试)。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "refactor(shiyue): rewire main.ts to workspace assembly (drop spike PdfView usage) (plan-b task9)"
```

---

### Task 10: 退役 spike embed(删文件 + esbuild + styles.css)

**Files:**
- Delete: `src/pdf-view.ts`、`src/pdfjs-version-shim.ts`、`src/pdf-worker.ts`、`scripts/scope-pdfjs-css.mjs`
- Modify: `esbuild.config.mjs`(删 `patchPdfViewerVersionCheck`)
- Modify: `styles.css`(清空重写)

- [ ] **Step 1: grep 确认无 retained importer** — 删之前确认保留代码不引这些 spike 文件:
```bash
grep -rn "pdf-view\|pdfjs-version-shim\|[\"']\.\./\.\./pdf-worker\|from \"\./pdf-worker\"" src --include="*.ts" | grep -v "pdf-worker-config\|pdf-text"
```
**期望:空输出**(main.ts 已不引;document-source 改引 `./pdf-worker-config`;workspace/core 都不引)。若有 hit 在保留文件 → 先修 import 再删。

- [ ] **Step 2: 删 spike 文件 + scope-css 脚本**
```bash
git rm src/pdf-view.ts src/pdfjs-version-shim.ts src/pdf-worker.ts
# 若 scripts/scope-pdfjs-css.mjs 存在:
ls scripts/scope-pdfjs-css.mjs 2>/dev/null && git rm scripts/scope-pdfjs-css.mjs
# 清理可能存在的空 scripts 目录(rm 不报错即跳过)
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 3: 改 `esbuild.config.mjs`** — 删 `patchPdfViewerVersionCheck` 定义(L32-65)+ `plugins` 数组里的它。最终 `plugins: [copyPdfWorker]`。改动后应长这样(关键行):
```javascript
// 删掉整个 patchPdfViewerVersionCheck = { ... } 块(L32-65)。
// 改 plugins 行:
  plugins: [copyPdfWorker],
```
`copyPdfWorker` 保留(文件级重读需要 `pdf.worker.min.mjs`)。

- [ ] **Step 4: 清空重写 `styles.css`** — 6872 行全是 spike 的 `.shiyue-pdf-root` 作用域 pdfjs CSS(原生 viewer 自带 CSS,不需要)。整文件替换为:
```css
/* 拾阅 / Shiyue — 工作区样式
 * spike embed 退役后重写:原生 PDF viewer 自带 CSS,这里只放工作区自有样式。
 * (原 6872 行 .shiyue-pdf-root 作用域 pdfjs CSS 由 scripts/scope-pdfjs-css.mjs 生成,已随 spike 退役删除。)
 */

/* 预估花费弹窗按钮(任务 4 confirmCost) */
.shiyue-confirm-btns { display: flex; gap: 0.5rem; margin-top: 0.75rem; }

/* AI 面板(任务 7 AiPanelView) */
.shiyue-ai-panel { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; height: 100%; }
.shiyue-ai-actions { display: flex; flex-direction: column; gap: 0.4rem; }
.shiyue-ai-actions button { padding: 0.5rem; }
.shiyue-ai-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.shiyue-ai-chat-placeholder {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); font-style: italic;
}

/* 图谱 logo(任务 6 被动注入 graph contentEl 右上角) */
.shiyue-logo {
  position: absolute; top: 0.5rem; right: 0.75rem; z-index: 10;
  cursor: pointer; font-size: 1.2rem; opacity: 0.7; user-select: none;
}
.shiyue-logo:hover { opacity: 1; }
```

- [ ] **Step 5: build** — `npm run build` → clean(无 spike 残留引用;esbuild 只剩 copyPdfWorker;styles.css 小且合法)。

- [ ] **Step 6: 全量测试** — `node --test --experimental-strip-types $(find src -name '*.test.ts')` → 50/50。

- [ ] **Step 7: 人工验(整工作区端到端)** — 测试 vault 重载插件,依次:
  1. Cmd+G 开图谱 → 右上角见 📖 logo。
  2. 点 logo → 右侧分两屏(上空预览 / 下 AI 面板「抽取整篇知识点」「选区知识点提取」两按钮,灰禁用)。
  3. 右键文件列表某 `.pdf` → 「在拾阅中打开」→ 上屏原生预览打开该 PDF,两按钮启用。
  4. 点「抽取整篇知识点」→ 预估弹窗 → 继续 → 跑批处理 → 知识点笔记入 `拾阅笔记/`(复用 Plan 2 行为)。
  5. 在预览里选中一段文字 → 点「选区知识点提取」→ 深抽生成笔记 + 自动打开。
  6. 选中文字 → 预览内右键 → 「深抽这个知识点」→ 同上(两触发共存)。
  7. 关掉预览面板 → 再点 logo / 右键打开 → preview 重建,功能恢复(`recreatePreviewLeaf`)。
  8. 图谱浮现新知识点节点(笔记写入后)。

  **若某步失败:** 记录现象(console + 截图),在 plan 文件 Task 10 下补 `> 人工验(YYYY-MM-DD):…`;失败步骤不阻塞 commit(代码已 build clean + 测试绿),但需在下一轮修。

- [ ] **Step 8: Commit**
```bash
git add -A && git commit -m "chore(shiyue): retire spike embed (delete pdf-view/pdf-worker/pdfjs-version-shim/scope-css + esbuild patch + nuke styles) (plan-b task10)"
```

---

## 自审

**1. Spec 覆盖:**
- §1 组件表全覆盖:logo 注入(Task 6 `registerLogoInjector`/`injectLogos`)、`ensureShiyueSplit`(Task 6)、`openInShiyue`(Task 6)、ai-panel view(Task 7)、file-menu hook(Task 8)、选区捕获(Task 2 `attachSelectionCapture`:mouseup + contextmenu 两触发)、批处理抽取(Task 5 `extractBatch` via PdfDocumentSource)、选区抽取(Task 5 `extractSelection` via PdfDocumentSource ±2 页)。
- §2 目录:`preview/selection-capture.ts`✓、`workspace/{shiyue-workspace,ai-panel-view,preview-tracker,file-menu,extraction-controller}.ts`✓(extraction-controller 是 spec §2 未列但 §1「抽取胶水」隐含的,且为 Agent 打地基所需——自审确认是合理增补,非超范围)、`ui/confirm-modal.ts`✓、`core/document/pdf-worker-config.ts`✓(configureWorker 迁入,保留文件级重读)。
- §3 选区两触发共存:AI 面板按钮(Task 7)+ 预览右键「深抽」(Task 2 `attachSelectionCapture` 的 contextmenu)→ 共用 `workspace.extractSelection` → `ExtractionController.extractSelection`。✓
- §4 复用/退役:Plan 2/3 逻辑复用(Task 5 调 BatchExtractor/SelectionExtractor/NoteGenerator/PdfDocumentSource);spike PdfView embed 退役(Task 10 删);`configureWorker` 移而非删(Task 5——修正了 spec 隐含的「删 pdf-worker.ts」会破坏文件级重读)。
- §5 DOM 假设:Task 1 人工验。
- §6 排序:A→B:Plan A 已完成,Plan B 在干净结构上建。
- §7 延后(不在本 plan):图谱节点右键(无公开 hook)、聊天 Agent、高亮 overlay、向量 RAG——均未实现,正确。✓

**2. 占位符扫描:** 无 TBD/TODO;所有 code step 含完整代码。`apiKey as string`(Task 5)是类型 cast(因 `getSecret` 类型宽),非占位。Task 6 `ShiyuePdfPickerModal.getItems` 的 `(this as any).items` 已在注里说明以 build clean 为准调法。

**3. 类型一致性:**
- `PanelActions`(Task 6 定义):`getCurrentFile`/`getCurrentSelection`/`onFileChange`/`extractBatch`/`extractSelection`——Task 7 AiPanelView 全用且签名一致。
- `SHIYUE_AI_PANEL_VIEW`(Task 7 定义)→ Task 6 构造参 `aiViewType` + Task 9 registerView。✓
- `SelectionCache.get/set/clear`(Task 2)→ Task 6 用 `get`;`SelInfo`(Task 2)→ Task 5 + 6 用。
- `PreviewTracker.get/set/onChange`(Task 3)→ Task 6 用(`onFileChange` 委派 `tracker.onChange`)。✓
- `ExtractionController.extractBatch(file)/extractSelection(file, sel)`(Task 5)→ Task 6 调。✓
- `confirmCost(app, {book,chunks,tokens,cost})`(Task 4)→ Task 5 调。✓
- `configureWorker(app, plugin)`(Task 5 移到 pdf-worker-config)→ document-source.ts import `./pdf-worker-config.ts` 调。✓

**4. 风险:**
- **分屏方向**(`getLeaf('split','right')` → preview,`'split','down')` → ai):Obsidian split 语义以 active leaf 为基准;若点 logo 时 graph 非激活,split 起点偏。Task 6 Step 1 在 logo onclick 调 ensureShiyueSplit——点 logo 前 graph 通常激活;Task 10 Step 7 #2 人工验几何,若上下颠倒改 `'down'` ↔ `'up'`。
- **contextmenu 劫持原生菜单**(Task 2):仅当有缓存选区时 preventDefault;无选区时让原生菜单通过。Task 10 Step 7 #6 人工验 UX。
- **`app.secretStorage.getSecret` 同步用法**(Task 5):原样照搬 main.ts:89(Plan 2 验证可工作);若实际返回 Promise 则是 pre-existing latent bug,Plan B 不引入也不修(超范围)。
- **document-source.test 可能 mock 旧 `../../pdf-worker.ts` 路径**(Task 5 Step 5):改 import 后测试若动态 import mock 路径,同步改成 `./pdf-worker-config.ts`;跑测试即知。
- **configureWorker 移动后根级 pdf-worker.ts 残留**(Task 5–9 期间):spike pdf-view.ts 可能仍引根级 `./pdf-worker`——保留根文件到 Task 10 一起删(避免中间态坏 spike)。Task 10 grep 确认后再删。✓
- **previewLeaf contentEl 时机**(Task 6 `attachPreviewCapture`):在 `openFile` 后挂(view 已稳定);native pdf 内 `.page` DOM 渲染异步但 mouseup listener 在 contentEl 冒泡,与渲染状态无关。✓

**5. 不破坏插件:** Task 9 重写 main.ts 前,Task 1-8 的新文件都不被 main.ts 引用(build tree-shake 剔除,中间态可编译)。Task 9 一切换装配即用新工作区。Task 10 删 spike 在 main.ts 已不引之后。中间态每步 build clean + 测试绿。✓

---

## 执行交接

Plan 完成,存于 `docs/superpowers/plans/2026-07-28-plan-b-workspace.md`。

**执行方式建议:** Plan B 混合纯逻辑 + obsidian 耦合,建议:
- **Task 1(人工 DOM gate)**:实现者先跑,结果写回 plan。
- **Task 2-5(纯逻辑 + 胶水,可 subagent)**:Task 2/3 TDD 可批量给一个 subagent(SelectionCache + PreviewTracker);Task 4/5 给一个 subagent(confirm-modal + configureWorker 移动 + extraction-controller)。两阶段 review(spec compliance + code quality)。
- **Task 6-9(obsidian 耦合,inline)**:分屏/AI 面板/file-menu/main 重写——这些 obsidian API 语义需边做边验,inline 执行 + 人工验更稳;或 subagent 但每任务人工验。
- **Task 10(退役 + 人工验)**:inline,删文件 + 重写 styles + 全量人工验(Task 10 Step 7 的 8 步)。

选哪种?(Subagent-Driven 推荐 Task 2-5;Task 6-10 inline 人工验)

