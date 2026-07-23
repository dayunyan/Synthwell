# 拾阅 / Shiyue — W0 Spike 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Obsidian 中搭建最小 PDF 阅读器 spike,验证 spec 章节 E 的 E1-E7 七项闸门,产出 Go/No-Go/Conditional-Go 决策。

**Architecture:** 标准 Obsidian 插件(TS + esbuild + obsidian-sample-plugin 范式),用 `pdfjs-dist` 在自定义 `ItemView` 里渲染 PDF,虚拟滚动 + Canvas 销毁控内存。本计划是**验证型 spike**——目标是回答「Worker 能否真起子线程、大 PDF 不崩、内存能回收、CJK 可选、学曲线可控、真实用户认可」,不是产出生产代码。验证以**观测协议**(spec E1-E7 验收)为「测试」,纯逻辑处用单元测试。

**Tech Stack:** TypeScript 5.4、esbuild、`obsidian` API、`pdfjs-dist`(W0 钉定版本)、一个 Obsidian 开发测试 vault。

**Spike 范围与纪律:** ~1 周 / 15h 上限。无 Plan B、无二次 spike、灰色=No-Go(spec 章节 E)。E1(Worker)与 E3(内存回收)是研究新加的硬闸门;E1 失败且无可用缓解 → No-Go。

**关联 spec:** `docs/superpowers/specs/2026-07-23-shiyue-product-design.md`(章节 C-F,尤其 E)。

---

## 文件结构

spike 阶段文件(刻意精简,只够验证):

| 文件 | 职责 |
|---|---|
| `manifest.json` | 插件清单(id=`shiyue`, `isDesktopOnly:true`, `minAppVersion:1.11.4` 因 SecretStorage) |
| `package.json` | 依赖与构建脚本 |
| `tsconfig.json` | TS 配置 |
| `esbuild.config.mjs` | 打包(输出 `main.js`) |
| `versions.json` | 版本映射 |
| `.gitignore` | 忽略 node_modules / main.js / dist |
| `src/main.ts` | Plugin 入口:registerView + 命令 + (空)SettingTab |
| `src/pdf-view.ts` | `PdfView extends ItemView`:渲染、虚拟滚动、清理 |
| `src/highlight.ts` | 文本锚定高亮纯逻辑(可单测) |
| `src/pdf-worker.ts` | Worker 配置(E1 验证的主战场) |
| `spike-results.md` | E1-E7 结果 + Go/No-Go 决策记录 |
| 测试 vault | `.obsidian/plugins/shiyue` 符号链接到本仓库 |

---

### Task 1: 脚手架插件 + 验证可加载(E5 学曲线证据)

**Files:**
- Create: `manifest.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `versions.json`, `.gitignore`, `src/main.ts`

- [ ] **Step 1: 写 `manifest.json`**

```json
{
  "id": "shiyue",
  "name": "拾阅 / Shiyue",
  "version": "0.1.0",
  "minAppVersion": "1.11.4",
  "description": "CJK-first local PDF reading + highlighting + AI + WeRead import",
  "author": "xujunda",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: 写 `package.json`**(暂不含 pdfjs-dist,Task 3 加)

```json
{
  "name": "obsidian-shiyue",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production"
  },
  "license": "AGPL-3.0",
  "devDependencies": {
    "@types/node": "^20.11.0",
    "builtin-modules": "^4.0.0",
    "esbuild": "0.21.5",
    "obsidian": "latest",
    "tslib": "2.6.2",
    "typescript": "5.4.5"
  }
}
```

- [ ] **Step 3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["DOM", "ES2022"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: 写 `esbuild.config.mjs`**

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) { await context.rebuild(); process.exit(0); } else { await context.watch(); }
```

- [ ] **Step 5: 写 `versions.json`**

```json
{ "0.1.0": "W0 spike" }
```

- [ ] **Step 6: 写 `.gitignore`**

```
node_modules/
main.js
dist/
*.log
```

- [ ] **Step 7: 写 `src/main.ts`**(最小可加载骨架)

```typescript
import { Plugin } from "obsidian";

export default class ShiyuePlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "shiyue-hello",
      name: "拾阅: 验证加载",
      callback: () => this.app.workspace.getLeaf().setViewState({
        type: "shiyue-pdf-view", // Task 2 才注册这个 view,本步先不触发
      }),
    });
    // Task 2 在此 registerView + 真正的打开命令
  }
}
```

> 注:Task 1 本步先让插件能加载、命令出现在命令面板;真正打开 view 在 Task 2。如本步命令触发报错(view 未注册)属正常。

- [ ] **Step 8: 安装依赖并构建**

Run: `npm install && npm run build`
Expected: 产出 `main.js`,无 TS 报错。

- [ ] **Step 9: 接入测试 vault**

在测试 vault `<vault>/.obsidian/plugins/` 下建符号链接:
```bash
ln -s /Users/xujunda/Developer/Synthwell <vault>/.obsidian/plugins/shiyue
```
Obsidian → 设置 → 第三方插件 → 关闭安全模式 → 启用「拾阅 / Shiyue」。

- [ ] **Step 10: 验证加载**

Obsidian 命令面板搜「拾阅」,应出现「拾阅: 验证加载」命令;设置→插件列表有「拾阅 / Shiyue」。
Expected: PASS。若失败,查 Obsidian 开发者控制台(Ctrl/Cmd+Shift+I)报错。

- [ ] **Step 11: 记录 E5 学曲线证据**

在 `spike-results.md` 记录 Task 1 实际耗时。E5 通过判据:Task 1 ≤1 天(脚手架本应快;若 >1 天,标记 E5 风险,因 spec 要求整体骨架 ≤5 天)。

- [ ] **Step 12: Commit**

```bash
git add manifest.json package.json package-lock.json tsconfig.json esbuild.config.mjs versions.json .gitignore src/main.ts
git commit -m "feat(shiyue): scaffold obsidian plugin (W0 spike task 1)"
```

---

### Task 2: PDF ItemView 骨架 + 打开命令

**Files:**
- Create: `src/pdf-view.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 写 `src/pdf-view.ts`**(空 view,Task 3 加渲染)

```typescript
import { ItemView, WorkspaceLeaf, TFile } from "obsidian";

export const SHIYUE_PDF_VIEW = "shiyue-pdf-view";

export class PdfView extends ItemView {
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return SHIYUE_PDF_VIEW; }
  getDisplayText(): string { return this.file?.basename ?? "拾阅 PDF"; }

  async onOpen() {
    const el = this.contentEl;
    el.empty();
    el.createEl("div", { text: "选择 PDF 后在此显示" });
  }

  async onClose() {
    // Task 6 在此做内存清理
  }

  async setFile(file: TFile) {
    this.file = file;
    this.contentEl.empty();
    this.contentEl.createEl("div", { text: `加载中: ${file.basename}` });
    // Task 3 在此渲染
  }
}
```

- [ ] **Step 2: 改 `src/main.ts`**:注册 view + 文件选择打开命令

把 `src/main.ts` 替换为:

```typescript
import { Plugin, TFile, FuzzySuggestModal } from "obsidian";
import { PdfView, SHIYUE_PDF_VIEW } from "./pdf-view";

export default class ShiyuePlugin extends Plugin {
  async onload() {
    this.registerView(SHIYUE_PDF_VIEW, (leaf) => new PdfView(leaf));

    this.addCommand({
      id: "open-pdf-in-shiyue",
      name: "拾阅: 打开 PDF",
      callback: () => this.openPdfPicker(),
    });
  }

  async onunload() {
    // registerView 的 leaf 会在卸载后残留,用 detachLeavesOfType 清理(spec D)
    this.app.workspace.detachLeavesOfType(SHIYUE_PDF_VIEW);
  }

  async openPdfPicker() {
    const pdfs = this.app.vault.getFiles().filter((f) => f.extension === "pdf");
    if (pdfs.length === 0) {
      new Notice("vault 中没有 .pdf 文件");
      return;
    }
    new FuzzySuggestModal(this.app)
      .setTitle("选择要打开的 PDF")
      .setItems(pdfs)
      .setPlaceholder("搜索文件名…")
      .onChooseItem((item: TFile) => this.openPdf(item))
      .open();
  }

  async openPdf(file: TFile) {
    const leaf = this.app.workspace.getLeaf("split", "right");
    await leaf.setViewState({ type: SHIYUE_PDF_VIEW, state: {} });
    const view = leaf.view;
    if (view instanceof PdfView) {
      await view.setFile(file);
    }
  }
}

// Notice 在 obsidian 包里,顶部导入补上
```

> 修正导入:`import { Plugin, TFile, FuzzySuggestModal, Notice } from "obsidian";`(把 Notice 加进顶部 import)。

- [ ] **Step 3: 构建并重载**

Run: `npm run build`
Obsidian 里重载插件(禁用→启用,或 Cmd/Ctrl+P → "Reload app without saving")。

- [ ] **Step 4: 验证**

命令面板 →「拾阅: 打开 PDF」→ 选一个 PDF → 右侧 split 打开一个显示「加载中: <文件名>」的 view。
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/pdf-view.ts src/main.ts
git commit -m "feat(shiyue): pdf itemview skeleton + open command (task 2)"
```

---

### Task 3: 集成 pdfjs-dist,渲染第 1 页

**Files:**
- Modify: `package.json`(加 pdfjs-dist)
- Modify: `src/pdf-view.ts`

- [ ] **Step 1: 安装 pdfjs-dist 并钉版本**

Run: `npm install pdfjs-dist`
然后查 `package.json` 里 `pdfjs-dist` 的 resolved 版本,记录到 `spike-results.md`。
查该版本是否含 #20334 修复(CJK word-spacing):看 `node_modules/pdfjs-dist/CHANGELOG.md` 或对照 pdfjs #20319 的 milestone。若不含,升级到含该修复的版本(spec E4 前提)。

- [ ] **Step 2: 写 `src/pdf-worker.ts`**(Worker 配置占位,Task 4 填实)

```typescript
import { GlobalWorkerOptions } from "pdfjs-dist";

// Task 4 在此选 A/B/C 配置并验证 E1。当前先占位:静态文件路径。
export function configureWorker() {
  // TODO(task4): 替换为验证通过的配置
  GlobalWorkerOptions.workerSrc = ""; // 占位,Task 4 填
}
```

- [ ] **Step 3: 改 `src/pdf-view.ts` `setFile`,渲染第 1 页**

```typescript
// 文件顶部加 import
import * as pdfjsLib from "pdfjs-dist";
import { configureWorker } from "./pdf-worker";

// PdfView 类内:
async setFile(file: TFile) {
  this.file = file;
  const el = this.contentEl;
  el.empty();
  configureWorker(); // Task 4 后此调用才真正生效

  const buf = await this.app.vault.adapter.readBinary(file.path);
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });

  const canvas = el.createEl("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  // 存引用供 Task 5/6 清理
  (this as any)._doc = doc;
  (this as any)._page = page;
  (this as any)._canvas = canvas;
}
```

- [ ] **Step 4: 构建并重载**

Run: `npm run build` → 重载插件。

- [ ] **Step 5: 验证**

打开一个 PDF → view 显示第 1 页的 Canvas 渲染。
Expected: PASS。控制台若有 "Setting up fake worker" → 记录,Task 4 必须解决(E1 未过)。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/pdf-view.ts src/pdf-worker.ts
git commit -m "feat(shiyue): render pdf page 1 via pdfjs-dist (task 3)"
```

---

### Task 4: E1 — Worker 验证(头号闸门)

**Files:**
- Modify: `src/pdf-worker.ts`

这是 spike 最关键的验证。Obsidian `app://` origin + CSP 下,blob-URL worker 易静默回退「fake worker」(主线程),导致后续滚动卡死。按序试 A→B→C,记录首个通过 E1 的配置。

- [ ] **Step 1: 配置 A — 静态 worker 文件**

esbuild 把 worker 拷到输出目录。在 `esbuild.config.mjs` 的 context 选项里加:
```javascript
loader: { ".mjs": "text" }, // 不行则改用 copy 插件
```
更稳的做法:用 esbuild `copy` 把 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` 拷到 `main.js` 同目录,命名 `pdf.worker.min.mjs`。在 `esbuild.config.mjs` 末尾加:
```javascript
import { cpSync } from "fs";
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs");
```
然后在 `src/pdf-worker.ts`:
```typescript
import { GlobalWorkerOptions } from "pdfjs-dist";
import { plugin } from "./main"; // 需要拿到插件资源路径

export function configureWorker(pluginApp: any) {
  // Obsidian 插件资源 URL 模式:app://<plugin-id>/<file>
  GlobalWorkerOptions.workerSrc = "app://shiyue/pdf.worker.min.mjs";
}
```
> 若 `app://shiyue/...` 不可用,Obsidian 另有 `this.app.vault.adapter.getResourcePath()` 或 `plugin.app.localForage` 之外的模式——本步就是探明正确路径。记录哪种 URL 模式可被 Worker 构造器接受。

- [ ] **Step 2: 验证配置 A**

构建 → 重载 → 打开 PDF → 开发者控制台。
Pass 判据:① 控制台**无** "Setting up fake worker";② 在 worker 文件顶部临时加 `console.log("[worker] running")`,确认该日志在 Worker 线程(可设 `self.name` 验证);③ 解析大 PDF 时 Obsidian UI(滚一篇笔记)不卡。

- [ ] **Step 3: 若 A 失败,配置 B — 模块 worker + workerPort**

改 `src/pdf-worker.ts`:
```typescript
import { GlobalWorkerOptions } from "pdfjs-dist";

export function configureWorker() {
  const worker = new Worker(
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" }
  );
  GlobalWorkerOptions.workerPort = worker;
}
```
esbuild 对 `new URL(..., import.meta.url)` 会产出单独 worker chunk。验证同 Step 2 判据。

- [ ] **Step 4: 若 B 仍失败,配置 C — disableWorker 兜底**

```typescript
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
export function configureWorker() {
  GlobalWorkerOptions.workerSrc = "";
}
// getDocument 调用处加 disableWorker: true —— 仅作兜底,主线程解析会慢
```
若只能靠 C 通过,标记 E1「勉强可用」→ 走 Conditional-Go 评估(主线程解析对大 PDF 体验差,可能仍 No-Go)。

- [ ] **Step 5: 记录 E1 结果**

`spike-results.md` 写:通过配置(A/B/C)+ 证据(无 fake worker 警告的截图/日志)。E1 PASS 要求 A 或 B 通过。

- [ ] **Step 6: Commit**

```bash
git add src/pdf-worker.ts esbuild.config.mjs spike-results.md
git commit -m "feat(shiyue): worker config validated (E1) — config <A|B|C>"
```

---

### Task 5: E2 — 大 PDF + 虚拟滚动

**Files:**
- Modify: `src/pdf-view.ts`

- [ ] **Step 1: 实现虚拟滚动骨架**

把 `setFile` 改为只渲染可见页 ±2,其余销毁。`src/pdf-view.ts` 加:

```typescript
private renderedPages = new Map<number, { canvas: HTMLCanvasElement; task: any }>();
private observer: IntersectionObserver | null = null;

async setFile(file: TFile) {
  this.file = file;
  const el = this.contentEl; el.empty();
  configureWorker();
  const buf = await this.app.vault.adapter.readBinary(file.path);
  this.doc = await pdfjsLib.getDocument({ data: buf }).promise;
  this.numPages = this.doc.numPages;

  // 占位 div(每页一个),按需渲染
  for (let i = 1; i <= this.numPages; i++) {
    const ph = el.createEl("div", { cls: "shiyue-page" });
    ph.dataset.page = String(i);
    ph.style.minHeight = "800px"; // 占位,渲染后替换
  }
  this.setupObserver();
}

setupObserver() {
  this.observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = Number((e.target as HTMLElement).dataset.page);
      if (e.isIntersecting) this.renderPage(p);
      else this.destroyPage(p);
    }
  }, { root: this.contentEl, rootMargin: "2px" }); // ±2 页靠 rootMargin 扩
  this.contentEl.querySelectorAll(".shiyue-page").forEach((d) => this.observer!.observe(d));
}

async renderPage(p: number) {
  if (this.renderedPages.has(p)) return;
  const ph = this.contentEl.querySelector(`[data-page="${p}"]`) as HTMLElement;
  const page = await this.doc.getPage(p);
  const vp = page.getViewport({ scale: 1.5 });
  const canvas = ph.createEl("canvas");
  canvas.width = vp.width; canvas.height = vp.height;
  const task = page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp });
  this.renderedPages.set(p, { canvas, task });
}

destroyPage(p: number) {
  const r = this.renderedPages.get(p);
  if (!r) return;
  r.task.cancel?.();
  r.canvas.width = 0; r.canvas.height = 0; // 释放
  r.canvas.remove();
  this.renderedPages.delete(p);
  // page.cleanup 由 doc.cleanup 统一处理
}
```

- [ ] **Step 2: 准备测试 PDF**

找/造两个 PDF:一个 200 页、一个 800 页(可合并多份报告生成)。

- [ ] **Step 3: 验证 200 页 <3s 打开**

Run(在 setFile 临时加计时):记录 `getDocument` 到首屏绘制的 `performance.now()` 差。
Pass:<3s 且滚动无明显卡顿。

- [ ] **Step 4: 验证 800 页不崩**

打开 800 页 PDF,从头滚到尾。
Pass:不崩溃、Obsidian 不卡死。记录峰值内存(下一步用)。

- [ ] **Step 5: 记录 E2 + Commit**

```bash
git add src/pdf-view.ts spike-results.md
git commit -m "feat(shiyue): virtual scroll + large pdf (E2)"
```

---

### Task 6: E3 — 内存回收(关视图后回基线)

**Files:**
- Modify: `src/pdf-view.ts`

- [ ] **Step 1: 实现 onClose 清理**

`PdfView.onClose`:
```typescript
async onClose() {
  this.observer?.disconnect();
  for (const p of [...this.renderedPages.keys()]) this.destroyPage(p);
  await this.doc?.cleanup();
  await this.doc?.destroy();
  this.doc = null;
}
```

- [ ] **Step 2: 内存观测协议**

打开 800 页 PDF → 活动监视器/任务管理器记录 Obsidian 进程内存:打开前(基线)、滚到尾(峰值)、关 view 后 10 秒(回收后)。
Pass:回收后内存回到基线 ±20% 以内。
若不回收(留高)→ 这是 Annotator #233 翻车模式,E3 FAIL,No-Go 候选。

- [ ] **Step 3: 记录 E3 + Commit**

```bash
git add src/pdf-view.ts spike-results.md
git commit -m "feat(shiyue): memory cleanup on close (E3)"
```

---

### Task 7: E4 — CJK 选区 + 文本锚定高亮决策

**Files:**
- Create: `src/highlight.ts`(纯逻辑,可单测)
- Modify: `src/pdf-view.ts`

- [ ] **Step 1: 写 `src/highlight.ts` 文本锚定纯逻辑 + 单测**

```typescript
export interface Anchor { prefix: string; exact: string; postfix: string; page: number; }

/** 从选区文本生成锚(取前后各 N 字符) */
export function buildAnchor(selected: string, pageText: string, page: number, window = 30): Anchor {
  const idx = pageText.indexOf(selected);
  if (idx < 0) throw new Error("selected text not found in page text");
  const start = Math.max(0, idx - window);
  const end = Math.min(pageText.length, idx + selected.length + window);
  return {
    prefix: pageText.slice(start, idx),
    exact: selected,
    postfix: pageText.slice(idx + selected.length, end),
    page,
  };
}

/** 在页面文本里用锚重定位选区起止 offset */
export function resolveAnchor(a: Anchor, pageText: string): { start: number; end: number } | null {
  const probe = a.prefix + a.exact + a.postfix;
  const at = pageText.indexOf(probe);
  if (at >= 0) return { start: at + a.prefix.length, end: at + a.prefix.length + a.exact.length };
  // 退化:只匹配 exact
  const e = pageText.indexOf(a.exact);
  return e >= 0 ? { start: e, end: e + a.exact.length } : null;
}
```

单测 `src/highlight.test.ts`(用 node 内置 `node:test`):
```typescript
import { test } from "node:test";
import assert from "node:assert";
import { buildAnchor, resolveAnchor } from "./highlight";

test("buildAnchor + resolveAnchor roundtrip", () => {
  const page = "飞轮效应是指一个业务过程中的正向循环…";
  const a = buildAnchor("飞轮效应", page, 1);
  const r = resolveAnchor(a, page);
  assert.ok(r);
  assert.equal(page.slice(r!.start, r!.end), "飞轮效应");
});
```

- [ ] **Step 2: 跑单测**

Run: `node --test --experimental-strip-types src/highlight.test.ts`
Expected: PASS。

- [ ] **Step 3: CJK 选区实测**

在 3 种中文 PDF 上(Word 导出、WPS 导出、LaTeX 导出)选中文字,观察选区高亮矩形与字形对齐情况。记录偏差现象到 `spike-results.md`。

- [ ] **Step 4: 接入文本锚定高亮**

`pdf-view.ts` 在 `renderPage` 后挂 TextLayer,选区触发 `buildAnchor`(用 `page.getTextContent()` 拼页面文本),`resolveAnchor` 重渲染高亮 span。最小实现:存锚 + 重渲染时定位。

- [ ] **Step 5: 记录 E4 决策**

`spike-results.md`:① pdfjs 版本含 #20334 修复?② 横向 CJK 偏差可接受?③ 文本锚定方案是否绕开偏移?Pass:含修复 + 横向可接受 + 锚定方案成立。OCR/竖排标实验性(不阻断)。

- [ ] **Step 6: Commit**

```bash
git add src/highlight.ts src/highlight.test.ts src/pdf-view.ts spike-results.md
git commit -m "feat(shiyue): text-anchored highlight + cjk selection test (E4)"
```

---

### Task 8: E6 — 真实用户招募 + 评分(流程任务,非代码)

**Files:**
- Create: `spike-results.md` 追加用户评分章节(无代码提交)

- [ ] **Step 1: 写测试指南 + 评分表**

5 题 1-5 分:① 打开速度 ② 滚动流畅度 ③ 高亮可用性 ④ 中文选区质量 ⑤ 总体体验。目标平均 ≥3.5/5。加开放反馈。

- [ ] **Step 2: 发布招募**

渠道:Obsidian 中文社区(论坛/群)+ Reddit r/ObsidianMD(英文)。筛选:Obsidian ≥6 月、桌面读 PDF 习惯、愿 30-60 分钟。

- [ ] **Step 3: 收 ≥2 位非社交圈用户评分**

打包 spike 构建(把 `main.js` + `manifest.js` + `pdf.worker.min.mjs` 发给用户,或给 BRAT 安装指引)。

- [ ] **Step 4: 记录 E6**

`spike-results.md` 记录每位用户评分 + 反馈。Pass:≥2 位、平均 ≥3.5/5。
若招不到人 → E6 FAIL(市场验证不可行),No-Go(spec 章节 E No-Go 第 3 条)。

- [ ] **Step 5: Commit**

```bash
git add spike-results.md
git commit -m "docs(shiyue): e6 real-user ratings recorded"
```

---

### Task 9: E5/E7 收口 + Go/No-Go 决策

**Files:**
- Modify: `spike-results.md`

- [ ] **Step 1: 汇总 E1-E7**

`spike-results.md` 列表:E1 Worker(配置 X 通过)、E2 大 PDF(200<3s✓/800 不崩✓)、E3 内存回收(✓/✗)、E4 CJK(修复含✓/横向✓/锚定✓)、E5 学曲线(Task1 实际 X 天,≤5)、E6 用户评分(均分 X,≥3.5)、E7 时间预算(是否破)。

- [ ] **Step 2: 套 spec 章节 E 决策规则**

- **Go**:E1-E5 全过 + E6 ≥3.5 + E7 可执行。
- **Conditional-Go**:仅 E1 或 E3 勉强可用但有明确技术路径 → ≤2 周修,仍不过则 No-Go。
- **No-Go**:E1 无可用缓解 / E3 不回收 / 招不到 ≥2 用户 / E5 >7 天 / 想再试一次(论证成瘾)。

- [ ] **Step 3: 写决策 + 下一步**

`spike-results.md` 末尾写明 Go/No-Go/Conditional-Go + 理由 + 下一步(Go → 起草 MVP 实现计划;No-Go → 终止,无 Plan B)。

- [ ] **Step 4: Commit**

```bash
git add spike-results.md
git commit -m "docs(shiyue): w0 spike decision (Go/No-Go/Conditional-Go)"
```

---

## 自审(对照 spec)

**1. Spec 覆盖**:spec 章节 E 的 E1-E7 → Task 4/5/6/7/8/9/Task1+9 全覆盖。章节 D 的 D1(Worker)→Task4;D2(清理)→Task5/6;D3(钉版本)→Task3 Step1;D4(写入串行化)→MVP 阶段(本 spike 不涉及编辑器写入,标注);D5(SecretStorage)→MVP(本 spike 不做 settings,标注);D7(向量)→P2 不在本 spike;D8(isDesktopOnly)→Task1 manifest。本 spike 只验证 E1-E7,符合范围。

**2. 占位符扫描**:Task 4 Step1 的 `app://shiyue/...` 是待探明的 URL 模式(明确标注「本步就是探明」),非偷懒占位。无 TBD/TODO 残留(Task 4 的 `TODO(task4)` 已在该任务内解决)。

**3. 类型一致性**:`SHIYUE_PDF_VIEW`、`PdfView`、`buildAnchor`/`resolveAnchor` 命名跨任务一致。`configureWorker` 签名 Task3 调用无参、Task4 改为可选 `pluginApp` 参数——**修正**:统一为 `configureWorker()`,Task4 用全局拿插件引用,不传参,避免不一致。已在本计划 Task4 代码体现。

**范围说明**:本计划只到 spike 决策。MVP(6 项 P0 + CJK 专项)是独立后续计划,spike Go 后再写。
