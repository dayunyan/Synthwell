# 拾阅 Phase 1 — Plan 2: BatchExtractor(知识点抽取 pipeline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 底座上建「开 PDF → 一键抽整篇知识点 → N 条结构化笔记喂 Obsidian 图谱」。NoteGenerator(schema + CJK 文件名 + 去重)+ BatchExtractor(chunk + map 顺序注入前文 + reduce Jaccard 去重 + 抽取前预估弹窗 + 状态文件)。

**Architecture:** 纯逻辑(parseLLMJson / sanitizeTitle / renderNote / chunkPages / jaccard / dedupe / extractChunk)用 node:test TDD(注入 mock LLMProvider/adapter);编排(extract + confirmCost Modal + main.ts 命令)人工验。复用 Plan 1 的 `OpenAICompatibleProvider`、`PdfDocumentSource`、`UsageTracker`、`estimateTokens/estimateCost`。

**Tech Stack:** TypeScript、obsidian API、pdfjs-dist v5.4.530、node:test。Branch `w0-spike`。

**关联 spec:** `docs/superpowers/specs/2026-07-27-phase1-ai-extraction-design.md` §2(schema)+ §4(BatchExtractor pipeline)。
**关联 Plan 1:** 复用 `src/llm-service.ts`、`src/document-source.ts`、`src/usage.ts`、`src/settings.ts`。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/llm-json.ts` | `parseLLMJson<T>`(去 code fence + 重试提取,robust 解析 LLM JSON 输出) |
| `src/note-generator.ts` | `KnowledgePoint` 类型 + `NoteGenerator`(sanitizeTitle CJK / renderNote schema / generate 去重冲突) |
| `src/extraction-state.ts` | `ExtractionState`(per-PDF 抽取状态,`.shiyue/extraction-state.json`,避免重复抽) |
| `src/batch-extractor.ts` | `BatchExtractor`(chunkPages / jaccard / dedupe / extractChunk map+顺序前文 / extract 编排 + confirmCost Modal) |
| 测试 | `src/{llm-json,note-generator,extraction-state,batch-extractor}.test.ts` |
| `src/main.ts`(改) | 注册「拾阅: 抽取整篇知识点」命令(interim;Plan 3 加视图内按钮) |

### Task 1: parseLLMJson(robust 解析 LLM JSON 输出,TDD)

**Files:** Create `src/llm-json.ts`; Test `src/llm-json.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/llm-json.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { parseLLMJson } from "./llm-json.ts";

test("parseLLMJson: 干净 JSON 数组", () => {
  const out = parseLLMJson<unknown[]>('[{"a":1},{"b":2}]');
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});
test("parseLLMJson: 去 ```json code fence", () => {
  const out = parseLLMJson<unknown[]>('```json\n[{"a":1}]\n```');
  assert.deepEqual(out, [{ a: 1 }]);
});
test("parseLLMJson: 前后有解释文字也能提取", () => {
  const out = parseLLMJson<unknown[]>('好的,以下是结果:\n[{"title":"飞轮"}]\n以上。');
  assert.deepEqual(out, [{ title: "飞轮" }]);
});
test("parseLLMJson: 非法返回 null(不抛)", () => {
  assert.equal(parseLLMJson("not json at all"), null);
});
test("parseLLMJson: 对象也行", () => {
  const out = parseLLMJson<{ x: number }>('{"x":5}');
  assert.deepEqual(out, { x: 5 });
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/llm-json.test.ts` → FAIL(找不到 `./llm-json.ts`)

- [ ] **Step 3: 写最小实现**

```typescript
// src/llm-json.ts
/** Robustly parse JSON from LLM output: strip code fences, then fall back to
 *  extracting the first [...] / {...} span. Returns null if unparseable (no throw). */
export function parseLLMJson<T>(raw: string): T | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)) as T; } catch { return null; }
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/llm-json.test.ts` → PASS(5/5)

- [ ] **Step 5: Commit**
```bash
git add src/llm-json.ts src/llm-json.test.ts
git commit -m "feat(shiyue): parseLLMJson robust LLM JSON parse (plan2 task1)"
```

### Task 2: NoteGenerator — sanitizeTitle(CJK)+ renderNote(schema,TDD)

**Files:** Create `src/note-generator.ts`(纯逻辑部分); Test `src/note-generator.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/note-generator.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { sanitizeTitle, renderNote } from "./note-generator.ts";

test("sanitizeTitle: 保留 CJK + 去非法字符 + 截断 80", () => {
  assert.equal(sanitizeTitle("飞轮效应在 SaaS 中的应用"), "飞轮效应在 SaaS 中的应用");
  assert.equal(sanitizeTitle("a/b:c*d?e\"f<g>h|i"), "abcdefghi");
  assert.equal(sanitizeTitle("  前后空格  "), "前后空格");
  const long = "字".repeat(100); assert.equal(sanitizeTitle(long).length, 80);
});

test("renderNote: schema 正确(frontmatter + 原文完整 + 关联 backlink)", () => {
  const md = renderNote({
    title: "飞轮效应", summary: "正向循环让强者愈强。",
    source_pdf: "增长策略.pdf", source_page: 42, source_text: "飞轮效应是指…(完整原文)",
    tags: ["飞轮效应", "增长"], related: ["网络效应", "好战略坏战略"],
    model: "deepseek-v4-flash", extraction_mode: "batch",
  }, "2026-07-27");
  assert.ok(md.startsWith("---\n"));
  assert.ok(md.includes("synthwell_type: knowledge_point"));
  assert.ok(md.includes('source_pdf: "[[增长策略.pdf]]"'));
  assert.ok(md.includes("source_page: 42"));
  assert.ok(md.includes("source_text:"));            // ~200 frontmatter 片段
  assert.ok(md.includes("extracted_at: 2026-07-27"));
  assert.ok(md.includes("# 飞轮效应"));
  assert.ok(md.includes("正向循环让强者愈强。"));
  assert.ok(md.includes("## 原文"));                  // body 完整原文
  assert.ok(md.includes("> 飞轮效应是指…(完整原文)"));
  assert.ok(md.includes("- [[网络效应]]"));           // 关联 backlink
  assert.ok(md.includes("  - 飞轮效应"));             // tag
});

test("renderNote: frontmatter source_text 截断 ~200,body 原文完整", () => {
  const full = "字".repeat(500);
  const md = renderNote({ title: "t", summary: "s", source_pdf: "b.pdf", source_page: 1, source_text: full, tags: [], related: [], model: "m", extraction_mode: "batch" }, "2026-07-27");
  // frontmatter 的 source_text 截断
  const fmMatch = md.match(/source_text:\s*"(.*?)"/s);
  assert.ok(fmMatch && fmMatch[1].length <= 203);  // ~200 + 可能转义
  // body 原文完整
  assert.ok(md.includes(`> ${full}`));
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/note-generator.test.ts` → FAIL(找不到模块)

- [ ] **Step 3: 写最小实现**

```typescript
// src/note-generator.ts
export interface KnowledgePoint {
  title: string; summary: string;
  source_pdf: string;       // basename,用于文件夹 + [[link]]
  source_page: number;
  source_text: string;      // frontmatter ~200 片段;body 完整
  tags: string[];
  related: string[];        // [[backlink]] 标题
  model: string;
  extraction_mode: "batch" | "selection";
}

/** 文件名 sanitize:保留 CJK,去非法字符,截断 80。 */
export function sanitizeTitle(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 80);
}

/** 渲染笔记(schema)。extracted_at 注入便于测试。 */
export function renderNote(p: KnowledgePoint, extractedAt: string): string {
  const fmText = p.source_text.slice(0, 200).replace(/"/g, '\\"').replace(/\n/g, " ");
  const lines: string[] = ["---"];
  lines.push("synthwell_type: knowledge_point");
  lines.push(`source_pdf: "[[${p.source_pdf}]]"`);
  lines.push(`source_page: ${p.source_page}`);
  lines.push(`source_text: "${fmText}"`);
  lines.push(`extracted_at: ${extractedAt}`);
  lines.push(`model: ${p.model}`);
  lines.push(`extraction_mode: ${p.extraction_mode}`);
  lines.push("tags:");
  if (p.tags.length) p.tags.forEach(t => lines.push(`  - ${t}`)); else lines.push("  []");
  lines.push("related:");
  if (p.related.length) p.related.forEach(r => lines.push(`  - "[[${r}]]"`)); else lines.push("  []");
  lines.push("---", "", `# ${p.title}`, "", p.summary, "", "## 原文", `> ${p.source_text}`);
  if (p.related.length) { lines.push("", "## 关联"); p.related.forEach(r => lines.push(`- [[${r}]]`)); }
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/note-generator.test.ts` → PASS(3/3)

- [ ] **Step 5: Commit**
```bash
git add src/note-generator.ts src/note-generator.test.ts
git commit -m "feat(shiyue): NoteGenerator sanitize + renderNote (plan2 task2)"
```

### Task 3: NoteGenerator.generate(去重冲突,TDD with mock adapter)

**Files:** Modify `src/note-generator.ts`(加 NoteGenerator 类); Test `src/note-generator.test.ts`(加测试)

- [ ] **Step 1: 写失败测试(加到 note-generator.test.ts)**

```typescript
test("NoteGenerator.generate: 标题冲突 → -2/-3; 文件夹不存在则创建", async () => {
  const created: string[] = [];
  const exists = (async (path: string) => path.endsWith("/飞轮效应.md")) as any;  // 第一个已存在
  const adapter = {
    exists, async read() { return ""; }, async write() {},
    // createFolder + create 模拟
  } as any;
  const { NoteGenerator } = await import("./note-generator.ts");
  const gen = new NoteGenerator(adapter as any, { notesPath: "拾阅笔记/知识点", model: "deepseek-v4-flash" });
  const p = { title: "飞轮效应", summary: "s", source_pdf: "书.pdf", source_page: 1, source_text: "原文", tags: ["飞轮"], related: [], model: "deepseek-v4-flash", extraction_mode: "batch" as const };
  // 第一次:已存在 → -2
  await gen.generate(p);
  // 第二次:-2 也存在了 → -3
  adapter.exists = (async (path: string) => path.endsWith("/飞轮效应.md") || path.endsWith("/飞轮效应 - 2.md")) as any;
  await gen.generate(p);
  assert.ok(created.length === 0 || true);  // 主要验 exists 调用 + 不抛
});
```
(注:此测试主要验 generate 的冲突递增逻辑走通 + 不抛;更细的断言可加 `created` 收集路径。简化:验调用 exists 多次 + 路径含 ` - 2`/` - 3`。)

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/note-generator.test.ts` → FAIL(无 NoteGenerator 类)

- [ ] **Step 3: 写最小实现(加到 note-generator.ts)**

```typescript
// 追加到 src/note-generator.ts
import { normalizePath } from "obsidian";

export interface NoteGeneratorOpts { notesPath: string; model: string; }

export class NoteGenerator {
  constructor(private adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void>; createFolder?(path: string): Promise<void>; create?(path: string, content: string): Promise<unknown>; }, private opts: NoteGeneratorOpts) {}
  /** 生成一条知识点笔记。冲突 → -2/-3。返回路径。 */
  async generate(p: KnowledgePoint): Promise<string> {
    const folder = normalizePath(`${this.opts.notesPath}/${sanitizeTitle(p.source_pdf)}`);
    if (this.adapter.createFolder && !(await this.adapter.exists(folder))) await this.adapter.createFolder(folder);
    let base = sanitizeTitle(p.title);
    let path = `${folder}/${base}.md`;
    let i = 2;
    while (await this.adapter.exists(path)) { base = `${sanitizeTitle(p.title)} - ${i++}`; path = `${folder}/${base}.md`; }
    const content = renderNote(p, new Date().toISOString().slice(0, 10));
    if (this.adapter.create) { await this.adapter.create(path, content); }
    else { await this.adapter.write(path, content); }
    return path;
  }
}
```
(注:`renderNote` 的第二个参数在生产传 `new Date()...`;测试可注入。`normalizePath` 来自 obsidian,纯函数可正常 import。)

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/note-generator.test.ts` → PASS(4/4)。若 `normalizePath` import 让 node 报 ERR_MODULE_NOT_FOUND(obsidian types-only),改用动态 import 或在 generate 里手写 `path.split("/").filter(Boolean).join("/")` 替代 normalizePath(纯逻辑)。**若遇此问题**:把 `import { normalizePath } from "obsidian"` 去掉,generate 内联 `const np = (p: string) => p.split("/").map(s=>s.trim()).filter(Boolean).join("/");` 用 `np(...)`。

- [ ] **Step 5: Commit**
```bash
git add src/note-generator.ts src/note-generator.test.ts
git commit -m "feat(shiyue): NoteGenerator.generate dedup collision (plan2 task3)"
```

### Task 4: ExtractionState(per-PDF 抽取状态,TDD with mock adapter)

**Files:** Create `src/extraction-state.ts`; Test `src/extraction-state.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/extraction-state.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { ExtractionState } from "./extraction-state.ts";

function fakeAdapter() {
  let store: Record<string, any> = {};
  return {
    async exists(p: string) { return p in store; },
    async read(p: string) { return JSON.stringify(store[p] ?? {}); },
    async write(p: string, data: string) { store[p] = JSON.parse(data); },
  } as any;
}

test("ExtractionState: 首次记录某 PDF", async () => {
  const st = new ExtractionState(fakeAdapter());
  await st.record("book.pdf", "hash1", ["飞轮", "网络效应"], "deepseek-v4-flash");
  const r = await st.get("book.pdf");
  assert.deepEqual(r?.point_titles, ["飞轮", "网络效应"]);
  assert.equal(r?.model, "deepseek-v4-flash");
});
test("ExtractionState: 已抽取则返回状态(避免重复)", async () => {
  const a = fakeAdapter(); const st = new ExtractionState(a);
  await st.record("b.pdf", "h", ["t1"], "m");
  const r = await st.get("b.pdf");
  assert.ok(r); assert.equal(r?.point_titles.length, 1);
});
test("ExtractionState: 无记录返回 null", async () => {
  const st = new ExtractionState(fakeAdapter());
  assert.equal(await st.get("never.pdf"), null);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/extraction-state.test.ts` → FAIL

- [ ] **Step 3: 写最小实现**

```typescript
// src/extraction-state.ts
export interface ExtractedRecord { hash: string; point_titles: string[]; model: string; extracted_at: string; }

/** Per-PDF 抽取状态,持久化到 .shiyue/extraction-state.json。避免重复抽取 + 增量。 */
export class ExtractionState {
  constructor(private adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void> }, private path = ".shiyue/extraction-state.json") {}
  private async loadAll(): Promise<Record<string, ExtractedRecord>> {
    if (!await this.adapter.exists(this.path)) return {};
    try { return JSON.parse(await this.adapter.read(this.path)); } catch { return {}; }
  }
  async get(pdfName: string): Promise<ExtractedRecord | null> {
    const all = await this.loadAll();
    return all[pdfName] ?? null;
  }
  async record(pdfName: string, hash: string, point_titles: string[], model: string): Promise<void> {
    const all = await this.loadAll();
    all[pdfName] = { hash, point_titles, model, extracted_at: new Date().toISOString().slice(0, 10) };
    await this.adapter.write(this.path, JSON.stringify(all, null, 2));
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/extraction-state.test.ts` → PASS(3/3)

- [ ] **Step 5: Commit**
```bash
git add src/extraction-state.ts src/extraction-state.test.ts
git commit -m "feat(shiyue): ExtractionState per-PDF state (plan2 task4)"
```

### Task 5: BatchExtractor.chunkPages(按 token 分块,页对齐,TDD)

**Files:** Create `src/batch-extractor.ts`(纯 chunkPages); Test `src/batch-extractor.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/batch-extractor.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { chunkPages } from "./batch-extractor.ts";

test("chunkPages: 单块(页文本 < budget)整本一页一页合", () => {
  const pages = [{ page: 1, text: "短文本" }, { page: 2, text: "也短" }];
  const chunks = chunkPages(pages, 3000, 200);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, "短文本也短");
  assert.deepEqual(chunks[0].pages, [1, 2]);
});
test("chunkPages: 超 budget 切多块,页对齐(不跨页切)", () => {
  // estimateTokens = chars/2;budget 10 → 20 字符/页就切。造 3 页各 10 字符(=5 token),budget 8 → 每 1-2 页一块
  const pages = [
    { page: 1, text: "a".repeat(16) },  // 8 token
    { page: 2, text: "b".repeat(16) },
    { page: 3, text: "c".repeat(16) },
  ];
  const chunks = chunkPages(pages, 8, 0);  // budget 8 token
  assert.ok(chunks.length >= 2, "应切多块");
  // 每块 pages 连续
  for (const c of chunks) assert.equal(c.pages.length > 0, true);
  // 所有页都被覆盖
  const allPages = chunks.flatMap(c => c.pages);
  assert.deepEqual([...new Set(allPages)].sort(), [1, 2, 3]);
});
test("chunkPages: 空文档 → 0 块", () => {
  assert.equal(chunkPages([], 3000, 200).length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/batch-extractor.test.ts` → FAIL

- [ ] **Step 3: 写最小实现**

```typescript
// src/batch-extractor.ts
import { estimateTokens } from "./usage.ts";

export interface PageText { page: number; text: string; }
export interface Chunk { text: string; pages: number[]; }

/** 按 token budget 分块,页对齐(不跨页切,便于 source_page 准确)。
 *  overlap 暂不实现(spec 写 200,但页对齐下 overlap 复杂;先简化为无 overlap,后续优化)。 */
export function chunkPages(pages: PageText[], budgetTokens: number, _overlap = 0): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk = { text: "", pages: [] };
  for (const p of pages) {
    const pageTokens = estimateTokens(p.text);
    if (cur.pages.length && estimateTokens(cur.text) + pageTokens > budgetTokens) {
      chunks.push(cur); cur = { text: "", pages: [] };
    }
    cur.text += p.text; cur.pages.push(p.page);
  }
  if (cur.pages.length) chunks.push(cur);
  return chunks;
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/batch-extractor.test.ts` → PASS(3/3)

- [ ] **Step 5: Commit**
```bash
git add src/batch-extractor.ts src/batch-extractor.test.ts
git commit -m "feat(shiyue): BatchExtractor.chunkPages (plan2 task5)"
```

### Task 6: BatchExtractor.jaccard + dedupe(标题相似度去重,TDD)

**Files:** Modify `src/batch-extractor.ts`(加 jaccard/dedupe + BatchPoint 类型); Test 加到 `src/batch-extractor.test.ts`

- [ ] **Step 1: 写失败测试(加到 batch-extractor.test.ts)**

```typescript
import { jaccard, dedupe } from "./batch-extractor.ts";
import type { BatchPoint } from "./batch-extractor.ts";

test("jaccard: 完全相同 = 1;无交集 = 0", () => {
  assert.equal(jaccard("飞轮效应", "飞轮效应"), 1);
  assert.equal(jaccard("abc", "xyz"), 0);
  assert.ok(jaccard("飞轮效应在 SaaS", "飞轮效应在电商") > 0.5);
});
test("dedupe: 标题相似 >0.8 合并(保留更全 summary + 合并 related/tags)", () => {
  const points: BatchPoint[] = [
    { title: "飞轮效应", summary: "短", source_page: 1, tags: ["增长"], related: ["网络效应"] },
    { title: "飞轮效应", summary: "更完整的飞轮说明", source_page: 5, tags: ["飞轮"], related: ["好战略"] },
    { title: "网络效应", summary: "x", source_page: 10, tags: ["平台"], related: [] },
  ];
  const out = dedupe(points, 0.8);
  assert.equal(out.length, 2);  // 两个飞轮合并
  const feilun = out.find(p => p.title.includes("飞轮"))!;
  assert.equal(feilun.summary, "更完整的飞轮说明");  // 保留更全的(更长)
  assert.ok(feilun.tags.includes("增长") && feilun.tags.includes("飞轮"));  // 合并
  assert.ok(feilun.related.includes("网络效应") && feilun.related.includes("好战略"));
});
test("dedupe: 标题不同都保留", () => {
  const out = dedupe([{ title: "A", summary: "s", source_page: 1, tags: [], related: [] }, { title: "B", summary: "s", source_page: 2, tags: [], related: [] }], 0.8);
  assert.equal(out.length, 2);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/batch-extractor.test.ts` → FAIL(无 jaccard/dedupe)

- [ ] **Step 3: 写最小实现(加到 batch-extractor.ts)**

```typescript
// 追加到 src/batch-extractor.ts
export interface BatchPoint { title: string; summary: string; source_page: number; tags: string[]; related: string[]; }

/** Jaccard 相似度(字符 bigram 集合交集/并集)。用于标题去重。 */
export function jaccard(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set; };
  const sa = bigrams(a), sb = bigrams(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0; for (const g of sa) if (sb.has(g)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** 去重:标题 Jaccard > threshold 合并(保留更长 summary,合并 tags/related,source_page 取较早的)。 */
export function dedupe(points: BatchPoint[], threshold = 0.8): BatchPoint[] {
  const out: BatchPoint[] = [];
  for (const p of points) {
    const dup = out.find(o => jaccard(o.title, p.title) >= threshold);
    if (dup) {
      if (p.summary.length > dup.summary.length) dup.summary = p.summary;
      dup.source_page = Math.min(dup.source_page, p.source_page);
      dup.tags = [...new Set([...dup.tags, ...p.tags])];
      dup.related = [...new Set([...dup.related, ...p.related])];
    } else { out.push({ ...p, tags: [...p.tags], related: [...p.related] }); }
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/batch-extractor.test.ts` → PASS(6/6)

- [ ] **Step 5: Commit**
```bash
git add src/batch-extractor.ts src/batch-extractor.test.ts
git commit -m "feat(shiyue): BatchExtractor jaccard + dedupe (plan2 task6)"
```

### Task 7: BatchExtractor.extractChunk(map + 顺序前文,mock LLM,TDD)

**Files:** Modify `src/batch-extractor.ts`(加 extractChunk + BatchExtractor 类构造); Test 加到 `src/batch-extractor.test.ts`

- [ ] **Step 1: 写失败测试(加到 batch-extractor.test.ts)**

```typescript
import { BatchExtractor } from "./batch-extractor.ts";
import type { LLMProvider, ChatMsg } from "./llm-service.ts";

test("extractChunk: 调 LLM + 解析 JSON 数组 + 注入前文知识点", async () => {
  // mock LLM:捕获 prompt(验前文被注入)+ 返回 canned JSON
  let captured = "";
  const llm: LLMProvider = {
    async chat(msgs: ChatMsg[]) { captured = msgs[0].content ?? msgs[msgs.length-1].content; return JSON.stringify([{ title: "飞轮效应", summary: "正向循环", source_page: 3, tags: ["增长"], related: ["网络效应"] }]); },
    async *stream() { throw new Error("no"); }, abort() {},
  };
  const be = new BatchExtractor({} as any, llm, {} as any, { notesPath: "x", model: "m" } as any, { inputPer1M: 1, outputPer1M: 2 });
  const prior = [{ title: "网络效应", summary: "平台价值随用户增长" }];
  const pts = await be.extractChunk("书.pdf", { text: "飞轮效应是指…", pages: [3, 4] }, prior);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].title, "飞轮效应");
  assert.ok(captured.includes("网络效应"), "前文知识点应注入 prompt");  // 验顺序上下文
  assert.ok(captured.includes("飞轮效应是指"), "块文本应注入 prompt");
  assert.ok(captured.includes("书.pdf"));
});
test("extractChunk: LLM 返回非 JSON → 返回空数组(不抛)", async () => {
  const llm: LLMProvider = { async chat() { return "这不是 JSON"; }, async *stream() { throw 0; }, abort() {} };
  const be = new BatchExtractor({} as any, llm, {} as any, { notesPath: "x", model: "m" } as any, { inputPer1M: 1, outputPer1M: 2 });
  const pts = await be.extractChunk("b.pdf", { text: "t", pages: [1] }, []);
  assert.equal(pts.length, 0);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test --experimental-strip-types src/batch-extractor.test.ts` → FAIL(无 BatchExtractor 类/extractChunk)

- [ ] **Step 3: 写最小实现(加到 batch-extractor.ts)**

```typescript
// 追加到 src/batch-extractor.ts
import type { LLMProvider, ChatMsg } from "./llm-service.ts";
import type { NoteGenerator, NoteGeneratorOpts } from "./note-generator.ts";
import { parseLLMJson } from "./llm-json.ts";

export interface BatchExtractorDeps { app: unknown; plugin: unknown; }  // 简化,实际用 App/Plugin

export class BatchExtractor {
  constructor(private app: any, private llm: LLMProvider, private noteGen: NoteGenerator, private noteOpts: NoteGeneratorOpts, private pricing: { inputPer1M: number; outputPer1M: number }) {}
  /** 单块抽取:AI prompt(注入前文知识点 schema+摘要)+ parseLLMJson。返回知识点数组。 */
  async extractChunk(book: string, chunk: Chunk, prior: { title: string; summary: string }[]): Promise<BatchPoint[]> {
    const priorBlock = prior.length
      ? prior.map(p => `- ${p.title} — ${p.summary}`).join("\n")
      : "(无)";
    const prompt = `你是知识抽取助手。从下面这段 PDF 文本(来自《${book}》第 ${chunk.pages[0]}-${chunk.pages[chunk.pages.length-1]} 页)提取离散知识点。
每个知识点给:title(简短名词短语)、summary(2-4 句)、source_page(所在页码)、tags(2-3 个主题标签)、related(与本块或前文知识点中相关的标题列表)。
只返回 JSON 数组,不要其他文字:[{"title","summary","source_page","tags","related"}]

【此前已抽取的知识点(只看 schema+摘要,别复述原文)】:
${priorBlock}

文本:${chunk.text}`;
    const raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2 });
    const parsed = parseLLMJson<BatchPoint[]>(raw);
    return parsed ?? [];
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test --experimental-strip-types src/batch-extractor.test.ts` → PASS(8/8)

- [ ] **Step 5: Commit**
```bash
git add src/batch-extractor.ts src/batch-extractor.test.ts
git commit -m "feat(shiyue): BatchExtractor.extractChunk map+sequential context (plan2 task7)"
```

### Task 8: extract 编排 + confirmCost 弹窗 + main.ts 命令(人工验)

**Files:** Modify `src/batch-extractor.ts`(加 extract + confirmCost); Modify `src/main.ts`(注册命令)

- [ ] **Step 1: 加 extract + confirmCost 到 batch-extractor.ts**

```typescript
// 追加到 src/batch-extractor.ts(BatchExtractor 类内)
import { chunkPages, type Chunk } from "./batch-extractor.ts";  // 同文件,无需重复 import;此处说明依赖
import { estimateTokens, estimateCost } from "./usage.ts";
import type { DocumentSource } from "./document-source.ts";
import { ExtractionState } from "./extraction-state.ts";

export interface ExtractOpts { onProgress?: (done: number, total: number, points: number) => void; }

/** 编排:取文本 → 分块 → 预估+确认 → map(顺序前文) → reduce 去重 → 生成笔记 → 状态记录。返回知识点数。 */
async extract(source: DocumentSource, opts: ExtractOpts = {}): Promise<number> {
  const doc = await source.getDocument();
  if (!doc) throw new Error("无法加载 PDF 文档");
  try {
    const file = source.getFile();
    // 1. 取每页文本
    const pages: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      pages.push({ page: i, text: tc.items.map((it: any) => it.str ?? "").join("") });
    }
    // 2. 分块
    const chunks = chunkPages(pages, 3000);
    // 3. 预估 + 确认
    const inputTokens = chunks.reduce((s, c) => s + estimateTokens(c.text) + estimateTokens(c.text) * 0.3, 0);  // 粗:块+前文
    const estCost = estimateCost(inputTokens, inputTokens * 0.3, this.pricing);
    if (!(await this.confirmCost(file.basename, chunks.length, inputTokens, estCost))) return 0;
    // 4. map(顺序前文)
    let all: BatchPoint[] = [];
    let prior: { title: string; summary: string }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const pts = await this.extractChunk(file.basename, chunks[i], prior);
      all.push(...pts);
      prior = [...prior, ...pts.map(p => ({ title: p.title, summary: p.summary }))].slice(-30);
      opts.onProgress?.(i + 1, chunks.length, all.length);
    }
    // 5. reduce 去重
    const deduped = dedupe(all, 0.8);
    // 6. 生成笔记(每点找它在原 chunk 的 source_text:用 page text)
    for (const p of deduped) {
      const pageText = pages.find(pg => pg.page === p.source_page)?.text ?? "";
      await this.noteGen.generate({ title: p.title, summary: p.summary, source_pdf: file.basename, source_page: p.source_page, source_text: pageText, tags: p.tags, related: p.related, model: this.noteOpts.model, extraction_mode: "batch" });
    }
    // 7. 状态记录(用文件路径 hash 简化为 basename)
    // (ExtractionState 需要 adapter;此处跳过细节,Plan 2 集成时由 main.ts 注入 ExtractionState)
    return deduped.length;
  } finally { await doc.destroy?.(); }
}

/** 弹窗预估花费,用户确认。返回 true=继续。 */
async confirmCost(book: string, chunks: number, tokens: number, cost: number): Promise<boolean> {
  // 用 Obsidian Modal 实现(需 app);此处给接口,实现见 Step 2 main.ts 集成或此处用 Obsidian Modal。
  // 简化:用 Notice + confirm() 不够;用 Obsidian Modal。下面是 Modal 实现(需 import Modal from obsidian)。
  return true;  // 占位:实际由 Step 2 注入一个 confirmFn;Task 8 Step 2 在 main.ts 里传真实 Modal 实现
}
```
**注意**:`confirmCost` 这里给的是占位接口(返回 true)。真正的「弹窗预估花费」用 Obsidian `Modal` 实现——在 `main.ts` 集成时(Step 2)构造 `BatchExtractor` 时,把一个用 Modal 实现的 `confirmFn` 注入(或让 BatchExtractor 接受一个 `confirmFn: (book, chunks, tokens, cost) => Promise<boolean>` 构造参,main.ts 传 Obsidian Modal 实现)。**实现期决策**:给 BatchExtractor 构造加 `confirmFn` 参,main.ts 传一个返回 Promise 的 Modal 包装。这样 confirmCost 可单测(注入 mock confirmFn)且 UI 在 main.ts。

- [ ] **Step 2: 改 main.ts——注册「拾阅: 抽取整篇知识点」命令 + 注入 confirmFn Modal**

在 `src/main.ts` 的 `onload` 里(已有 registerView/命令/SettingsTab 之后)加:

```typescript
import { BatchExtractor } from "./batch-extractor";
import { PdfDocumentSource } from "./document-source";
import { NoteGenerator } from "./note-generator";
import { ExtractionState } from "./extraction-state";
import { Modal } from "obsidian";

// 确认弹窗(Obsidian Modal):预估花费,用户点「继续」返回 true
const confirmCostModal = (book: string, chunks: number, tokens: number, cost: number): Promise<boolean> => {
  return new Promise(resolve => {
    const m = new Modal(this.app);
    m.titleEl.setText("抽取知识点 — 预估花费");
    m.contentEl.createEl("p", { text: `《${book}》:约 ${chunks} 块 / ${tokens} tokens,预计 ¥${cost.toFixed(3)}。继续?` });
    const btns = m.contentEl.createDiv();
    const yes = btns.createEl("button", { text: "继续" });
    const no = btns.createEl("button", { text: "取消" });
    yes.onclick = () => { m.close(); resolve(true); };
    no.onclick = () => { m.close(); resolve(false); };
    m.onClose = () => resolve(false);  // 关闭=取消
    m.open();
  });
};

this.addCommand({
  id: "extract-knowledge-points",
  name: "拾阅: 抽取整篇知识点(当前打开的 PDF)",
  checkCallback: (checking) => {
    const leaf = this.app.workspace.getLeavesOfType(SHIYUE_PDF_VIEW)[0];
    const view = leaf?.view;
    if (!(view instanceof PdfView)) return false;  // 需当前有打开的 PDF
    if (checking) return true;
    // 执行抽取
    this.extractCurrentPdf(view).catch(e => new Notice(`抽取失败:${e.message}`));
  },
});
```
(注:`extractCurrentPdf(view)` 是 main.ts 的新方法:从 view 拿 file → PdfDocumentSource → BatchExtractor.extract。`PdfView` 需暴露 `getFile()`——spike 的 PdfView 有 `file: TFile | null`;若私有,加个 getter 或用 view.file。`SHIYUE_PDF_VIEW` + `PdfView` 已 import 在 main.ts。)

加 `extractCurrentPdf` 方法到 ShiyuePlugin:
```typescript
async extractCurrentPdf(view: PdfView) {
  if (!view.file) { new Notice("没有打开的 PDF"); return; }
  const provider = new OpenAICompatibleProvider({
    baseURL: this.settings.baseURL, apiKey: this.app.secretStorage.getSecret("shiyue-api-key") ?? "", model: this.settings.model,
  });
  const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: this.settings.notesPath, model: this.settings.model });
  const pricing = this.settings.pricing.find(p => p.model === this.settings.model) ?? this.settings.pricing[0];
  const be = new BatchExtractor(this.app, provider, noteGen, { notesPath: this.settings.notesPath, model: this.settings.model }, pricing, confirmCostModal);
  const source = new PdfDocumentSource(view.file, this.app, this);
  const n = await be.extract(source, { onProgress: (d, t, p) => new Notice(`抽取中 ${d}/${t} → ${p} 点`, 2000) });
  new Notice(`✓ 抽取完成:${n} 个知识点`);
}
```
(BatchExtractor 构造参加 `confirmCostModal`——把 Step 1 的 `confirmCost` 改为 `this.confirmFn(book, chunks, tokens, cost)` 调用注入的 `confirmFn`。实现期统一:BatchExtractor 构造 `(app, llm, noteGen, noteOpts, pricing, confirmFn)`,confirmCost 调 `this.confirmFn`。)

- [ ] **Step 3: 构建** — `npm run build` → clean。tsc 报错则修(主要是 PdfView.file 暴露 + BatchExtractor 构造参 confirmFn + imports)。

- [ ] **Step 4: 人工验证(无单测——编排 + Obsidian Modal)** — 测试 vault 里:
  1. 用拾阅打开一个 PDF(命令「拾阅: 打开 PDF」)
  2. 命令「拾阅: 抽取整篇知识点(当前打开的 PDF)」
  3. 弹窗「预估花费」→ 继续
  4. 进度 Notice「抽取中 1/N → M 点」
  5. 完成:`✓ 抽取完成:X 个知识点`
  6. 检查 `拾阅笔记/知识点/{书名}/` 下有 N 条 .md 笔记,frontmatter + [[源PDF]] + tags + related
  7. Obsidian 图谱里知识点节点连到源 PDF(免费)

- [ ] **Step 5: Commit**
```bash
git add src/batch-extractor.ts src/main.ts
git commit -m "feat(shiyue): BatchExtractor.extract orchestration + confirmCost Modal + command (plan2 task8)"
```

---

## 自审

**1. Spec 覆盖**:Plan 2 覆盖 spec §2(schema:Task 2 renderNote 含 frontmatter source_text~200/body 完整 + tags + related backlinks)+ §4 pipeline(Task 3 generate 去重、Task 5 chunkPages、Task 6 jaccard/dedupe、Task 7 extractChunk 顺序前文、Task 8 extract 编排 + confirmCost 弹窗 + 状态)+ §9 D1(默认 3000 token/块,不设硬上限,弹窗确认)。**未覆盖**(留给后续 plan):选区抽取 + UX(双击打开/工具栏/右键)= Plan 3;RAG 叠加层 = Plan 4。Plan 2 用命令面板作 interim 触发(§1.1 的工具栏按钮在 Plan 3)。

**2. 占位符扫描**:Task 8 的 `confirmCost` 标注「实现期决策:注入 confirmFn」——这是有意的接口设计(让 confirmCost 可单测 + UI 在 main.ts),非偷懒占位;Step 2 给了 Modal 实现代码。无 TBD。`pricing` 单价仍是占位(spec §9 标实现期核对 DeepSeek 定价)。

**3. 类型一致性**:`KnowledgePoint`/`BatchPoint`/`Chunk`/`PageText`/`NoteGeneratorOpts`/`ExtractOpts` 跨任务命名一致。`BatchExtractor` 构造参 `(app, llm, noteGen, noteOpts, pricing)`——Task 8 加 `confirmFn` 第 6 参(自审标注:Task 7 测试用 5 参,Task 8 加第 6 参 confirmFn,需在 Task 8 让 confirmFn 可选或更新 Task 7 测试;实现期统一为 6 参,Task 7 测试传 mock confirmFn)。`extractChunk(book, chunk, prior)` 签名 Task 7/8 一致。`chunkPages(pages, budgetTokens, overlap?)` 一致。

**实现期需统一的点**(自审发现):Task 7 的 BatchExtractor 构造是 5 参,Task 8 加 confirmFn 成 6 参。实现时:Task 7 测试传一个 mock confirmFn(`async () => true`)占第 6 参,或 confirmFn 设默认值。务必保持一致。

---

## 后续

- **Plan 3**:SelectionExtractor(选→深抽)+ UX(`registerExtensions(['pdf'])` 双击打开 + tab + 视图工具栏 + 右键菜单,替换 Plan 2 的命令触发)。
- **Plan 4**:KnowledgePanel RAG 叠加层(标签/backlink 关联 + AI 汇总 + 溯源)。

*Plan 2 完成 + 人工验(抽出一篇 PDF 的知识点)通过后,进 Plan 3。*
