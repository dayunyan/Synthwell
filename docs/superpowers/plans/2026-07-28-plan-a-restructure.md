# 拾阅 — Plan A:重构地基(模块化 core/ 布局)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 `src/*.ts` 纯逻辑文件机械迁入 spec §2 的模块化 `core/` 布局,改 import,验 50/50 测试绿 + build clean。**不动** spike embed(`pdf-view.ts`/`pdf-worker.ts`/`pdfjs-version-shim.ts`)与 `main.ts` 的装配逻辑(只改它们的 import 路径)。产出干净地基,插件仍可用。

**Architecture:** 纯机械移动 + import 路径更新。tsc(`-noEmit -skipLibCheck`)是 import 正确性的 source of truth——它报哪个模块解析失败,就修那个 import 到新相对路径。node:test 50 个测试是行为正确性的护栏。每 folder 一个 commit。

**Tech Stack:** TypeScript、node:test、git mv。Branch `w0-spike`。

**关联 spec:** `docs/superpowers/specs/2026-07-28-shiyue-workspace-design.md` §2(目标目录)+ §6(Plan A 范围)。

---

## 文件移动表(from → to)

| 源 | 目标 |
|---|---|
| `src/llm-service.ts` + `.test.ts` | `src/core/llm/llm-service.ts` + `.test.ts` |
| `src/llm-json.ts` + `.test.ts` | `src/core/llm/llm-json.ts` + `.test.ts` |
| `src/usage.ts` + `.test.ts` | `src/core/llm/usage.ts` + `.test.ts` |
| `src/batch-extractor.ts` + `.test.ts` | `src/core/extraction/batch-extractor.ts` + `.test.ts` |
| `src/selection-extractor.ts` + `.test.ts` | `src/core/extraction/selection-extractor.ts` + `.test.ts` |
| `src/note-generator.ts` + `.test.ts` | `src/core/extraction/note-generator.ts` + `.test.ts` |
| `src/extraction-state.ts` + `.test.ts` | `src/core/extraction/extraction-state.ts` + `.test.ts` |
| `src/document-source.ts` + `.test.ts` | `src/core/document/document-source.ts` + `.test.ts` |
| `src/highlight.ts` + `.test.ts` | `src/core/document/pdf-text.ts` + `.test.ts`(**重命名**) |
| `src/vault-fs.ts`(无 test) | `src/core/fs/vault-fs.ts` |
| 新建 | `src/core/extraction/normalize.ts`(Task 5 从 batch-extractor 抽 normalizePoint) |

**不动**:`src/main.ts`、`src/settings.ts`、`src/settings-tab.ts`、`src/pdf-view.ts`、`src/pdf-worker.ts`、`src/pdfjs-version-shim.ts`、`esbuild.config.mjs`、`styles.css`(spike embed + 其 build 管线 Plan B 再退役;本 plan 只改它们的 import 路径)。

## import 更新规则

- 移动后,每个文件内的相对 import 按新位置重算。**规则**:从 `src/core/extraction/batch-extractor.ts` 看,同 folder 用 `./X.ts`,跨 folder 用 `../llm/usage.ts` / `../document/document-source.ts` / `../fs/vault-fs.ts`。
- 测试文件随源文件一起移动,内部相对 import 同步改(`./llm-service.ts` → `../llm/llm-service.ts` 等)。
- 根级 importer(`main.ts`/`settings-tab.ts`/`pdf-view.ts`)的 import 改成 `./core/llm/llm-service`、`./core/document/pdf-text` 等。
- **`highlight.ts` → `pdf-text.ts` 重命名**:所有 `from "./highlight"` 改成 `from "./core/document/pdf-text"`(根级)或 `from "./pdf-text"`(同 folder)。
- `import type` / `import` 的 `.ts` 扩展名保留(strip-types 要求)。
- **tsc 是 source of truth**:`npm run build` 报 module not found → 改对应 import 到新路径,循环直到 clean。

---

### Task 1: scaffold 目录 + 迁 core/llm/(llm-service, llm-json, usage + tests)

**Files:** Move 6 files; update imports in moved files + importers (main.ts, settings-tab.ts, usage→ModelPricing from settings).

- [ ] **Step 1: 建目录 + git mv**
```bash
mkdir -p src/core/llm src/core/extraction src/core/document src/core/fs
git mv src/llm-service.ts src/core/llm/llm-service.ts
git mv src/llm-service.test.ts src/core/llm/llm-service.test.ts
git mv src/llm-json.ts src/core/llm/llm-json.ts
git mv src/llm-json.test.ts src/core/llm/llm-json.test.ts
git mv src/usage.ts src/core/llm/usage.ts
git mv src/usage.test.ts src/core/llm/usage.test.ts
```

- [ ] **Step 2: 修移动文件内部 import**
  - `core/llm/usage.ts`:`import type { ModelPricing } from "./settings.ts"` → `"../../settings.ts"`(settings 留在根)。
  - `core/llm/llm-service.ts` / `llm-json.ts`:无跨 folder import(自包含)。检查是否有,无则跳过。
  - `core/llm/llm-service.test.ts`:`import ... from "./llm-service.ts"`(同 folder,不变)、`from "./llm-json.ts"` → `"./llm-json.ts"`(同 folder)等。
  - `core/llm/usage.test.ts`:`import { ... } from "./usage.ts"`(不变)、动态 `await import("./usage.ts")`(不变)。

- [ ] **Step 3: 修根级 importer**
  - `src/main.ts`:`from "./llm-service"` → `"./core/llm/llm-service"`;`from "./usage"` → `"./core/llm/usage"`。
  - `src/settings-tab.ts`:`from "./llm-service"` → `"./core/llm/llm-service"`;`from "./usage"` → `"./core/llm/usage"`。

- [ ] **Step 4: 验** — `node --test --experimental-strip-types src/core/llm/llm-service.test.ts src/core/llm/llm-json.test.ts src/core/llm/usage.test.ts` → 绿。`npm run build` → clean(tsc 报的 module not found 逐个修到 clean)。

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "refactor(shiyue): migrate core/llm/ (llm-service, llm-json, usage) (plan-a task1)"
```

### Task 2: 迁 core/extraction/(batch-extractor, selection-extractor, note-generator, extraction-state + tests)

- [ ] **Step 1: git mv**
```bash
git mv src/batch-extractor.ts src/core/extraction/batch-extractor.ts
git mv src/batch-extractor.test.ts src/core/extraction/batch-extractor.test.ts
git mv src/selection-extractor.ts src/core/extraction/selection-extractor.ts
git mv src/selection-extractor.test.ts src/core/extraction/selection-extractor.test.ts
git mv src/note-generator.ts src/core/extraction/note-generator.ts
git mv src/note-generator.test.ts src/core/extraction/note-generator.test.ts
git mv src/extraction-state.ts src/core/extraction/extraction-state.ts
git mv src/extraction-state.test.ts src/core/extraction/extraction-state.test.ts
```

- [ ] **Step 2: 修移动文件 import**(按 §import 规则):
  - `batch-extractor.ts`:`./usage.ts`→`../llm/usage.ts`;`./llm-json.ts`→`../llm/llm-json.ts`;`./llm-service.ts`→`../llm/llm-service.ts`;`./note-generator.ts`→`./note-generator.ts`(同 folder);`./document-source.ts`→`../document/document-source.ts`;`./extraction-state.ts`→`./extraction-state.ts`(同 folder)。
  - `selection-extractor.ts`:`./llm-service.ts`→`../llm/llm-service.ts`;`./llm-json.ts`→`../llm/llm-json.ts`。
  - `note-generator.ts`:`./vault-fs.ts`→`../fs/vault-fs.ts`(Task 4 迁后;Task 2 时 vault-fs 还在根 → 先 `../../vault-fs.ts`,Task 4 再改成 `../fs/vault-fs.ts`。**或**:Task 2 先不动 note-generator 的 vault-fs import,留 `../../vault-fs.ts` 指向根的 vault-fs,Task 4 迁 vault-fs 时一并改)。**选后者更简单**:Task 2 note-generator 的 `./vault-fs.ts` → `../../vault-fs.ts`(临时指向根),Task 4 改成 `../fs/vault-fs.ts`。
  - `extraction-state.ts`:`./vault-fs.ts`→`../../vault-fs.ts`(同上,Task 4 改)。
  - 测试文件的相对 import 同步改(`./batch-extractor.ts` 同 folder 不变;`./llm-service.ts`→`../llm/llm-service.ts` 等)。

- [ ] **Step 3: 修根级 importer** — `src/main.ts`:`./batch-extractor`→`./core/extraction/batch-extractor`;`./selection-extractor`→`./core/extraction/selection-extractor`;`./note-generator`→`./core/extraction/note-generator`;`./extraction-state`→`./core/extraction/extraction-state`。

- [ ] **Step 4: 验** — 跑 4 个测试文件 → 绿;`npm run build` → clean(tsc 逐个修)。

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "refactor(shiyue): migrate core/extraction/ (batch, selection, note-gen, state) (plan-a task2)"
```

### Task 3: 迁 core/document/(document-source + highlight→pdf-text 重命名)+ tests

- [ ] **Step 1: git mv(含重命名 highlight→pdf-text)**
```bash
git mv src/document-source.ts src/core/document/document-source.ts
git mv src/document-source.test.ts src/core/document/document-source.test.ts
git mv src/highlight.ts src/core/document/pdf-text.ts
git mv src/highlight.test.ts src/core/document/pdf-text.test.ts
```

- [ ] **Step 2: 修移动文件 import**
  - `document-source.ts`:`import type { TFile, App, Plugin } from "obsidian"` 不变;`import type { PDFDocumentProxy } from "pdfjs-dist"` 不变;内部 `await import("./pdf-worker.ts")` → `"../../pdf-worker.ts"`(pdf-worker 留根,spike,Plan B 删)。
  - `pdf-text.ts`(原 highlight):无跨 folder import(自包含)。
  - 测试 `pdf-text.test.ts`:`import ... from "./pdf-text.ts"`(同 folder,原 `./highlight.ts` 改成 `./pdf-text.ts`)。
  - `document-source.test.ts`:`from "./document-source.ts"`(同 folder,不变)。

- [ ] **Step 3: 修根级 + 跨 folder importer**
  - `src/main.ts`:`from "./document-source"`→`./core/document/document-source`;`from "./highlight"`(pageTextFromItems)→`./core/document/pdf-text`。
  - `src/pdf-view.ts`(spike):`from "./highlight"`(buildAnchor, pageTextFromItems)→`./core/document/pdf-text`。
  - `src/core/extraction/batch-extractor.ts`:它 import `./document-source.ts`?查——Task 2 已改成 `../document/document-source.ts`。确认对。
  - `src/core/extraction/selection-extractor.ts`:不 import document-source,跳过。

- [ ] **Step 4: 验** — 跑 document-source + pdf-text 测试 → 绿;`npm run build` → clean。

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "refactor(shiyue): migrate core/document/ + rename highlight→pdf-text (plan-a task3)"
```

### Task 4: 迁 core/fs/(vault-fs)+ 修正 extraction 文件的 vault-fs import

- [ ] **Step 1: git mv**
```bash
git mv src/vault-fs.ts src/core/fs/vault-fs.ts
```

- [ ] **Step 2: 修跨 folder import(vault-fs 现在在 core/fs/)**
  - `src/core/extraction/note-generator.ts`:`../../vault-fs.ts`(Task 2 临时)→`../fs/vault-fs.ts`。
  - `src/core/extraction/extraction-state.ts`:同上 →`../fs/vault-fs.ts`。
  - `src/core/llm/usage.ts`:`../../vault-fs.ts`(Task 1 临时,若有)→`../fs/vault-fs.ts`。查 usage.ts 是否 import vault-fs(它用 ensureFolder/dirOf in record)——是,改。

- [ ] **Step 3: 验** — 全量测试 `node --test --experimental-strip-types src/core/**/*.test.ts`(若 shell 不展开 **,用 `src/core/llm/*.test.ts src/core/extraction/*.test.ts src/core/document/*.test.ts`)+ spike 测试(`src/highlight` 已迁,跳过)`src/*.test.ts`(只剩 settings/llm-service? 都迁了)。实际:**所有 .test.ts 现在在 src/core/***,跑全量:`node --test --experimental-strip-types $(find src -name '*.test.ts')` → 50/50 绿。`npm run build` → clean。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "refactor(shiyue): migrate core/fs/ (vault-fs) + fix extraction imports (plan-a task4)"
```

### Task 5: 抽 normalizePoint → core/extraction/normalize.ts

**Files:** Create `src/core/extraction/normalize.ts`; Modify `src/core/extraction/batch-extractor.ts`(import 而非内联)

- [ ] **Step 1: 建 normalize.ts** — 把 `batch-extractor.ts` 里的 `normalizePoint` 函数(非 exported,在 1a86596 加的)原样移出:
```typescript
// src/core/extraction/normalize.ts
import type { BatchPoint } from "./batch-extractor.ts";

/** 规范化 LLM 返回的单条知识点:补缺省、强转类型、丢弃无标题的残项。
 *  在 extractChunk 边界统一清洗,避免 dedupe 里 [...p.tags] 炸 "not iterable"。 */
export function normalizePoint(raw: any, fallbackPage: number): BatchPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const page = Number(raw.source_page);
  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === "string" && t.trim()) : [],
    related: Array.isArray(raw.related) ? raw.related.filter((r: any) => typeof r === "string" && r.trim()) : [],
  };
}
```
(注:`BatchPoint` 接口在 batch-extractor.ts 是 exported 的;normalize.ts import 它。或把 `BatchPoint` 也抽到 normalize.ts / 一个 types.ts——MVP 保持 normalize.ts 引 batch-extractor 的 BatchPoint 即可,无循环(batch-extractor 引 normalize 的函数,normalize 引 batch-extractor 的 type——type-only import 不构成运行时循环,但为干净可把 BatchPoint 定义放 normalize.ts,batch-extractor 反过来引。**选后者**:BatchPoint 移到 normalize.ts,batch-extractor `import { normalizePoint, type BatchPoint } from "./normalize.ts"`。)
```typescript
// src/core/extraction/normalize.ts(最终版:BatchPoint + normalizePoint 都在这)
export interface BatchPoint { title: string; summary: string; source_page: number; tags: string[]; related: string[]; }

export function normalizePoint(raw: any, fallbackPage: number): BatchPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const page = Number(raw.source_page);
  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === "string" && t.trim()) : [],
    related: Array.isArray(raw.related) ? raw.related.filter((r: any) => typeof r === "string" && r.trim()) : [],
  };
}
```

- [ ] **Step 2: 改 batch-extractor.ts** — 删内联 `BatchPoint` 接口 + `normalizePoint` 函数;改成 `import { normalizePoint, type BatchPoint } from "./normalize.ts"`;其余(jaccard/dedupe/extractChunk/extract 用 BatchPoint 的地方)不变。dedupe 签名 `dedupe(points: BatchPoint[], ...)` 仍引用 BatchPoint(从 normalize.ts re-export?不——import 的 type 可直接用)。

- [ ] **Step 3: 验** — 全量测试 50/50 绿(行为不变,纯抽取);`npm run build` → clean。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "refactor(shiyue): extract normalizePoint + BatchPoint to normalize.ts (plan-a task5)"
```

### Task 6: 全量验证 + 清理

- [ ] **Step 1: 全量测试** — `node --test --experimental-strip-types $(find src -name '*.test.ts')` → 50/50 pass。

- [ ] **Step 2: build** — `npm run build` → clean(无 module not found、无类型错)。

- [ ] **Step 3: 人工验插件仍可用** — 测试 vault 重载插件:命令「拾阅: 打开 PDF」仍能打开 spike viewer(本 plan 不退役 embed);批处理命令仍能跑(Plan 2 行为不回归)。**若不验也可**(Plan B 会动这块),但确认 build clean + 测试绿即足够。

- [ ] **Step 4: 确认目录结构** — `find src -name '*.ts' | sort` 应只剩根级 `main.ts`/`settings.ts`/`settings-tab.ts`/`pdf-view.ts`/`pdf-worker.ts`/`pdfjs-version-shim.ts` + `src/core/{llm,extraction,document,fs}/*.ts`。无 `src/*.test.ts` 残留(全迁入 core/)。

- [ ] **Step 5: Commit(若有清理)**
```bash
git add -A && git commit -m "chore(shiyue): plan-a final verify (50/50 green, build clean, structure matches spec §2)"
```

---

## 自审

**1. Spec 覆盖**:覆盖 spec §2 全部目标路径(llm/extraction/document/fs 四 folder + normalize.ts)+ §6「Plan A 重构地基,保留 spike,测试把关」。**未覆盖**(留给 Plan B):`preview/`/`workspace/`/`ui/` 目录(新建)+ 退役 spike embed + 建工作区功能。

**2. 占位符**:Task 2/4 的 vault-fs import「临时 `../../vault-fs.ts`→Task 4 改 `../fs/vault-fs.ts`」是分步迁移的中间态,非占位——两步都有明确最终态。Task 5 给了 normalize.ts 两个版本(初版 + 最终 BatchPoint 同位版),指示选最终版。

**3. 类型一致性**:`BatchPoint` 从 batch-extractor.ts 移到 normalize.ts(Task 5),batch-extractor 改 import `{ normalizePoint, type BatchPoint }`——`BatchPoint` 仍是同一形状,dedupe/jaccard/extract 签名不变。`normalizePoint` 签名 `(raw, fallbackPage)` 与 1a86596 原版一致。

**4. 风险**:
- import 路径漏改 → tsc 报 module not found,逐个修(Step 4 的 build 是 gate)。
- `git mv` 后测试文件找不到 → 全量 `find src -name '*.test.ts'` 跑。
- `highlight→pdf-text` 重命名漏改 importer → tsc 报(Step 3 gate)。
- spike `pdf-view.ts` 的 `./highlight` import 必须改成 `./core/document/pdf-text`(Task 3 Step 3),否则 spike viewer 坏——tsc 会报。

**5. 不破坏插件**:不动 main.ts 装配逻辑、不删 spike embed,只改 import 路径 → 插件行为不变,Plan B 再退役 embed。

---

## 后续

- **Plan B**:建 `preview/`+`workspace/`+`ui/` + logo/分屏/AI 面板/file-menu/选区捕获/抽取接线;退役 spike embed + 其 build 管线(esbuild copyPdfWorker/patchPdfViewerVersionCheck/scope-pdfjs-css + styles.css `.shiyue-pdf-root`)。
- **Plan B 第一步**:验原生 viewer DOM 含 `.page[data-page-number]`(spec §5)。

*Plan A 完成(50/50 绿 + build clean + 目录匹配 spec §2)后,进 Plan B。*
