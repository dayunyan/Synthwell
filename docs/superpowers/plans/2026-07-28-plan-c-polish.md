# 拾阅 — Plan C: 工作区打磨 + 抽取鲁棒性(人工验反馈 9 项)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 Plan B 人工验的 9 项反馈:logo 移到视图头栏(#2)、「在拾阅中打开」同 split 新标签页而非新窗(#3)、抽取 loading 改持续 Notice+spinner+可取消(#4/#5/#8)、长文档分块重写 10k 上限+长文≥3+章节对齐+每块≥1 保底(#6)、右键「深抽」改 capture 阶段(#7)、tag 清洗去划线(#9)。

**Architecture:** 纯逻辑(#1/#2-chunking/#6/#9 + 取消线程)在 `core/extraction`、`preview/`、`ui/` TDD;obsidian 耦合(logo DOM、tab 行为、contextmenu capture、loading Notice)人工验。复用 Plan B 已成的 workspace 骨架,只改 `injectLogos`/`openInShiyue`/`attachSelectionCapture` + 新 `ui/loading-notice.ts` + `ExtractionController` 接线。

**Tech Stack:** TypeScript、Obsidian 公开 API(Notice/`getLeaf(true)`/`.view-actions` DOM)、pdfjs `getOutline()`、node:test、esbuild cjs。

**关联:** spec `2026-07-28-shiyue-workspace-design.md`、Plan B `2026-07-28-plan-b-workspace.md`。

---

## 关键事实(实现者必读)

1. **`ChatOpts.signal` 已存在**——`OpenAICompatibleProvider.chat` 已把 `o.signal ?? this.controller.signal` 传给 fetch(llm-service.ts:5,38)。取消只需把一个 `AbortController.signal` 贯穿 `BatchExtractor.extract`/`SelectionExtractor.extract` → `extractChunk` → `llm.chat({signal})`,provider 层零改动。
2. **`chunkPages` 签名保持兼容**——`(pages, budgetTokens, _overlap=0, chapters: number[]=[], longDocThreshold=10000)`。现有 3 参测试(`chunkPages(pages,3000,200)` 等)不改仍绿;≥3 强制仅在 `totalTokens>longDocThreshold` 且自然分块<3 时降 budget。
3. **`extractChunk` 加可选 `opts?: { forceAtLeastOne?: boolean; signal?: AbortSignal }`**——现有无 opts 调用行为不变(现有测试绿)。`forceAtLeastOne` 时 prompt 加"必须≥1条,禁止空数组";`signal` 透传 `llm.chat`。
4. **每块≥1 保底放 `extract()` 不放 `extractChunk`**——`extractChunk` 仍返回 LLM 给的(0 就 0);`extract` 在 extractChunk 返回 0 后:① 重试 `extractChunk(...,{forceAtLeastOne:true})` ② 仍 0 则 `synthesizePoint(chunk)` 兜底合成 1 点。这样 `extractChunk` 契约/测试不破。
5. **tags 只在 frontmatter 渲染**(note-generator.ts:33 `tags:` 列表)——`normalizePoint`/`normalizeSelectionPoint` 只过滤非字符串,不清洗空格/标点。LLM 出 `["机器学习, NLP"]` → frontmatter 单 tag 含空格 → Obsidian 判非法 → 划线。修:normalize 边界 `splitTag`(拆列表分隔符)+ `sanitizeTag`(空格/`#`/`|`→`_`,去标点,截 100)。
6. **Notice 接 HTMLElement 作 message** + 有 `setMessage`/`hide`;`new Notice(el, 0)` = 持续(0 不自动隐)。spinner 用 CSS 动画(`.shiyue-spinner`,加 styles.css)。
7. **contextmenu capture 阶段**——原生 PDF viewer 的 bubble-phase handler 会 stopPropagation 拦截我们 contentEl 上的 listener。改 `addEventListener("contextmenu", h, true)`(capture)先于原生触发。
8. **logo 注入点**——`leaf.view.containerEl.querySelector(".view-actions")`(视图头栏右侧动作区,含「...」more 按钮);prepend logo → 在「...」左侧。`.view-actions` 找不到则退回 contentEl(降级)。
9. **tab 行为**——`previewLeaf` 有文件(`this.tracker.get()` 非空且 leaf 有效)→ `setActiveLeaf(preview)` + `getLeaf(true)`(同 split 新标签页);preview 空 → `previewLeaf.openFile(file)` 替换。`getLeaf(true)` 在 active leaf 的 split 开新 tab。
10. **`synthesizePoint(chunk)`**——兜底点:title=chunk.text.trim 首行或首 40 字;summary=首 ~120 字;source_page=chunk.pages[0];tags=[];related=[]。

---

## 文件结构

**新建:**
| 文件 | 职责 | 验证 |
|---|---|---|
| `src/ui/loading-notice.ts` | `LoadingNotice`:持续 Notice(spinner + 文本 + Stop 按钮)+ `show`/`update`/`hide`,Stop 回调 abort | 人工验 |
| `src/core/extraction/synthesize.ts` | `synthesizePoint(chunk)` 兜底合成 1 点 | TDD |

**修改:**
| 文件 | 改动 |
|---|---|
| `src/core/extraction/normalize.ts` | 加 `sanitizeTag`/`splitTag`;`normalizePoint` tags 用之(拆+清+去重) |
| `src/core/extraction/selection-extractor.ts` | `normalizeSelectionPoint` tags 用 `sanitizeTag`/`splitTag`(import normalize) |
| `src/core/extraction/batch-extractor.ts` | `chunkPages` 加 chapters+threshold+≥3 强制;`extractChunk` 加 opts(forceAtLeastOne/signal);`extract` 加 signal/onConfirmed/每块≥1 保底;`ExtractOpts` 加字段 |
| `src/core/extraction/selection-extractor.ts` | `extract` 加 `signal?` 透传 `llm.chat` |
| `src/preview/selection-capture.ts` | contextmenu listener 改 capture 阶段 |
| `src/workspace/shiyue-workspace.ts` | `injectLogos`→`.view-actions` prepend;`openInShiyue`→空替换/有文件新 tab |
| `src/workspace/extraction-controller.ts` | 建 `AbortController`+`LoadingNotice`;batch `onConfirmed` 后显 notice;selection 显 notice;透传 signal;Stop→abort |
| `styles.css` | 加 `.shiyue-spinner`(旋转动画) |

---

### Task 1: tag 清洗(`sanitizeTag`/`splitTag` 在 normalize 边界)

**Files:** Modify `src/core/extraction/normalize.ts`;Create test additions in `src/core/extraction/normalize.test.ts`(新建);Modify `src/core/extraction/selection-extractor.ts`(import + 用);更新 `batch-extractor.test.ts`/`selection-extractor.test.ts` 若有 tag 断言。

- [ ] **Step 1: 写失败测试**
```typescript
// src/core/extraction/normalize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTag, splitTag, normalizePoint } from "./normalize.ts";

test("sanitizeTag: CJK 原样保留", () => {
  assert.equal(sanitizeTag("机器学习"), "机器学习");
});
test("sanitizeTag: 去首 #", () => {
  assert.equal(sanitizeTag("#增长"), "增长");
});
test("sanitizeTag: 内部空格→_", () => {
  assert.equal(sanitizeTag("machine learning"), "machine_learning");
});
test("sanitizeTag: 标点→_ 并合并/去首尾", () => {
  assert.equal(sanitizeTag("增长!策略"), "增长_策略");
  assert.equal(sanitizeTag("a,,b"), "a_b");
  assert.equal(sanitizeTag("  飞轮 效应  "), "飞轮_效应");
});
test("sanitizeTag: 空/纯标点 → 空串", () => {
  assert.equal(sanitizeTag(""), "");
  assert.equal(sanitizeTag(",,,,"), "");
  assert.equal(sanitizeTag(null as any), "");
});
test("sanitizeTag: 截长 100", () => {
  assert.equal(sanitizeTag("a".repeat(150)).length, 100);
});

test("splitTag: 拆列表分隔符(逗号/顿号/分号/斜杠)", () => {
  assert.deepEqual(splitTag("机器学习, NLP"), ["机器学习", "NLP"]);
  assert.deepEqual(splitTag("a/b、c；d"), ["a", "b", "c", "d"]);
});
test("splitTag: 非字符串 → []", () => {
  assert.deepEqual(splitTag(null), []);
  assert.deepEqual(splitTag(123 as any), []);
});

test("normalizePoint: tags 拆+清+去重", () => {
  const p = normalizePoint({ title: "T", summary: "s", source_page: 1,
    tags: ["机器学习, NLP", "#增长", "飞轮 效应", "增长", null, 123] }, 1);
  assert.deepEqual(p!.tags, ["机器学习", "NLP", "增长", "飞轮_效应"]);
});
test("normalizePoint: tags 缺/非数组 → []", () => {
  assert.deepEqual(normalizePoint({ title: "T" }, 1)!.tags, []);
  assert.deepEqual(normalizePoint({ title: "T", tags: "x" }, 1)!.tags, []);
});
```

- [ ] **Step 2: 跑确认失败** — `node --test --experimental-strip-types src/core/extraction/normalize.test.ts` → FAIL(`sanitizeTag` 未导出)。

- [ ] **Step 3: 写实现**
```typescript
// src/core/extraction/normalize.ts
export interface BatchPoint { title: string; summary: string; source_page: number; tags: string[]; related: string[]; }

/** Obsidian 标签禁空格/#/|;CJK 允许。把非法字符→_,去首 #,合并连续_,截 100。
 *  解决 LLM 出 "机器学习, NLP" 作单 tag → frontmatter 非法 → 划线(#9)。 */
export function sanitizeTag(t: unknown): string {
  let s = typeof t === "string" ? t : "";
  if (!s) return "";
  s = s.replace(/^#+/, "");
  s = s.replace(/[\s#|]+/g, "_");
  s = s.replace(/[，,、;；:：。.()（）【】\[\]"'`!！?？@&*^%$+=<>{}]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return s.slice(0, 100);
}

/** 拆列表分隔符(逗号/顿号/分号/斜杠),不拆空格(空格留给 sanitizeTag→_)。
 *  非 string → []。 */
export function splitTag(t: unknown): string[] {
  if (typeof t !== "string") return [];
  return t.split(/[,，、;；\\\/]+/).map((s) => s.trim()).filter(Boolean);
}

function unique<T>(a: T[]): T[] { return Array.from(new Set(a)); }

/** 规范化 LLM 返回的单条知识点:补缺省、强转类型、丢弃无标题的残项。
 *  tags:拆列表分隔 + 逐个 sanitizeTag + 去重(在信任边界统一清洗,避免 frontmatter 非法 tag)。 */
export function normalizePoint(raw: any, fallbackPage: number): BatchPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const page = Number(raw.source_page);
  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(raw.tags)
      ? unique((raw.tags as unknown[]).flatMap(splitTag).map(sanitizeTag).filter((s) => s.length > 0))
      : [],
    related: Array.isArray(raw.related) ? raw.related.filter((r: any) => typeof r === "string" && r.trim()) : [],
  };
}
```

- [ ] **Step 4: 改 selection-extractor 的 tag 清洗** — `normalizeSelectionPoint` tags 同样用 `splitTag`+`sanitizeTag`+去重。在 selection-extractor.ts 顶部加 `import { sanitizeTag, splitTag } from "./normalize.ts";`,把 `tags:` 那行改成与 normalizePoint 一致的拆+清+去重逻辑。`related` 不变(related 是 title,非 tag,Obsidian `[[link]]` 允许更多字符)。

- [ ] **Step 5: 跑测试通过 + 不回归** — `node --test --experimental-strip-types src/core/extraction/normalize.test.ts src/core/extraction/selection-extractor.test.ts` → 绿。`batch-extractor.test.ts` 里 `dedupe` 测试的 tags 断言(`pts[0].tags` 等)仍绿(那些 tag 无非法字符)。全量 `node --test --experimental-strip-types $(find src -name '*.test.ts')` → 之前 59 + 新增 ~9 = 绿。

- [ ] **Step 6: build** — `npm run build` → clean。

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "fix(shiyue): sanitize tags at normalize boundary (#9 plan-c task1)"
```

---

### Task 2: `chunkPages` 重写(10k + 长文≥3 + 章节对齐)+ `synthesizePoint` 兜底

**Files:** Modify `src/core/extraction/batch-extractor.ts`(`chunkPages` + 新 `synthesizePoint` + 新 `chapterBoundaries` helper);Add tests in `src/core/extraction/batch-extractor.test.ts`。

- [ ] **Step 1: 写失败测试**(追加到 batch-extractor.test.ts)
```typescript
import { chunkPages, synthesizePoint } from "./batch-extractor.ts";
import type { Chunk } from "./batch-extractor.ts";

test("chunkPages: 章节边界处切(不跨章)", () => {
  // 3 页,每页 ~4 token;budget 100;第 2 页是章首 → 在第 2 页前切
  const pages = [{page:1,text:"a".repeat(16)},{page:2,text:"b".repeat(16)},{page:3,text:"c".repeat(16)}];
  const chunks = chunkPages(pages, 100, 0, [2]);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].pages, [1]);
  assert.deepEqual(chunks[1].pages, [2, 3]);
});
test("chunkPages: 长文档(>threshold)且自然<3 → 降 budget 强制≥3", () => {
  // 每页 3000 token,2 页共 6000(<threshold 10000? 用小 threshold 测)
  // 用 threshold=4000:total 6000>4000,自然 budget 10000 → 1 块(<3)→ 强制 3 块
  const pages = [{page:1,text:"x".repeat(12000)},{page:2,text:"y".repeat(12000)}];
  const chunks = chunkPages(pages, 10000, 0, [], 4000);
  assert.ok(chunks.length >= 3, `应≥3 块,实际 ${chunks.length}`);
});
test("chunkPages: 短文档不强制≥3(1 块)", () => {
  const pages = [{page:1,text:"短"}];
  assert.equal(chunkPages(pages, 10000, 0, [], 4000).length, 1);
});

test("synthesizePoint: 兜底合成 1 点(title=首40字,page=chunk首页,tags/related空)", () => {
  const chunk: Chunk = { text: "这是一段没有抽出知识点的文本内容,作为兜底。".repeat(3), pages: [5, 6] };
  const p = synthesizePoint(chunk);
  assert.equal(p.source_page, 5);
  assert.deepEqual(p.tags, []);
  assert.deepEqual(p.related, []);
  assert.ok(p.title.length > 0 && p.title.length <= 40);
  assert.ok(p.summary.length > 0);
});
test("synthesizePoint: 空文本 → title 用页码兜底", () => {
  const p = synthesizePoint({ text: "   ", pages: [7] });
  assert.equal(p.title, "第7页摘要");
  assert.equal(p.source_page, 7);
});
```

- [ ] **Step 2: 跑确认失败** — `node --test --experimental-strip-types src/core/extraction/batch-extractor.test.ts` → 新测试 FAIL(章节切/≥3 强制/synthesize 未实现)。

- [ ] **Step 3: 写实现** — 替换 `chunkPages` + 加 `synthesizePoint` + 加 `chapterBoundaries`(private,extract 用)。`Chunk` 已 exported(line 11)。
```typescript
// src/core/extraction/batch-extractor.ts —— 替换原 chunkPages(line 15-27)
/** 按 token budget 分块,页对齐 + 章节边界对齐。
 *  长文档(totalTokens>longDocThreshold)且自然分块<3 时,降 budget=ceil(total/3) 强制≥3 块。
 *  chapters:章首页码列表;在该页前若当前块非空则切(尽量同章不跨块)。 */
export function chunkPages(pages: PageText[], budgetTokens: number, _overlap = 0, chapters: number[] = [], longDocThreshold = 10000): Chunk[] {
  if (pages.length === 0) return [];
  const totalTokens = pages.reduce((s, p) => s + estimateTokens(p.text), 0);
  let budget = budgetTokens;
  if (totalTokens > longDocThreshold) {
    const natural = chunkByBudget(pages, budget, chapters);
    if (natural.length < 3) budget = Math.max(1, Math.ceil(totalTokens / 3));
  }
  return chunkByBudget(pages, budget, chapters);
}

function chunkByBudget(pages: PageText[], budgetTokens: number, chapters: number[]): Chunk[] {
  const bounds = new Set(chapters.filter((p) => p >= 1));
  const chunks: Chunk[] = [];
  let cur: Chunk = { text: "", pages: [] };
  const push = () => { if (cur.pages.length) { chunks.push(cur); cur = { text: "", pages: [] }; } };
  for (const p of pages) {
    const pageTokens = estimateTokens(p.text);
    const overBudget = cur.pages.length && estimateTokens(cur.text) + pageTokens > budgetTokens;
    const atChapterStart = cur.pages.length && bounds.has(p.page);
    if (overBudget || atChapterStart) push();
    cur.text += p.text; cur.pages.push(p.page);
  }
  push();
  return chunks;
}

/** 兜底合成 1 个知识点(每块≥1 保底的第三层:prompt→重试→合成)。
 *  title=首行或首 40 字;summary=首 ~120 字;source_page=chunk 首页;tags/related 空。 */
export function synthesizePoint(chunk: Chunk): BatchPoint {
  const text = chunk.text.trim();
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const title = (firstLine || text).slice(0, 40) || `第${chunk.pages[0]}页摘要`;
  return {
    title,
    summary: text.slice(0, 120) || title,
    source_page: chunk.pages[0],
    tags: [],
    related: [],
  };
}

/** best-effort 从 PDF outline 取章首页码。无 outline / 解析失败 → [](退回纯页对齐)。 */
async function chapterBoundaries(doc: any): Promise<number[]> {
  try {
    const outline = await doc.getOutline?.();
    if (!Array.isArray(outline) || !outline.length) return [];
    const pages: number[] = [];
    for (const item of outline) {
      const dest = item?.dest;
      const ref = Array.isArray(dest) && dest.length ? dest[0] : null;
      if (ref == null) continue;
      try { const idx = await doc.getPageIndex(ref); pages.push(idx + 1); } catch { /* skip unresolvable */ }
    }
    return Array.from(new Set(pages)).sort((a, b) => a - b);
  } catch { return []; }
}
```

- [ ] **Step 4: 跑测试通过** — `node --test --experimental-strip-types src/core/extraction/batch-extractor.test.ts` → 全绿(含原 3 个 chunkPages 测试 + 新 5 个)。

- [ ] **Step 5: build** — `npm run build` → clean。

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(shiyue): chunkPages 10k+long-doc>=3+chapter-align + synthesizePoint fallback (#6 plan-c task2)"
```

---

### Task 3: `extractChunk` opts(force/signal)+ `extract` 每块≥1 保底 + 取消线程

**Files:** Modify `src/core/extraction/batch-extractor.ts`(`extractChunk` 加 opts + catch;`extract` 加 signal/onConfirmed/≥1 保底/abort 检查;`ExtractOpts` 加字段)。

- [ ] **Step 1: 写失败测试**(追加)
```typescript
test("extractChunk: forceAtLeastOne 时 prompt 含强制语", async () => {
  let captured = "";
  const llm: LLMProvider = { async chat(m){captured=m[0].content;return "[]";}, async *stream(){throw 0;}, abort(){} };
  const be = new BatchExtractor({} as any, llm, {} as any, { notesPath:"x", model:"m" } as any, { inputPer1M:1, outputPer1M:2 });
  await be.extractChunk("b.pdf", { text:"t", pages:[1] }, [], { forceAtLeastOne: true });
  assert.ok(captured.includes("至少1条") || captured.includes("禁止返回空数组"));
});
test("extractChunk: llm.chat 抛错(含 abort)→ catch 返回 [] 不炸", async () => {
  const llm: LLMProvider = { async chat(){throw new Error("aborted");}, async *stream(){throw 0;}, abort(){} };
  const be = new BatchExtractor({} as any, llm, {} as any, { notesPath:"x", model:"m" } as any, { inputPer1M:1, outputPer1M:2 });
  const pts = await be.extractChunk("b.pdf", { text:"t", pages:[1] }, [], { signal: new AbortController().signal });
  assert.equal(pts.length, 0);  // 不抛,返回空
});
```

- [ ] **Step 2: 跑确认失败** — `extractChunk` 第 4 参 opts 不存在 → tsc 报错。

- [ ] **Step 3: 写实现** — 改 `extractChunk` 签名 + try/catch;改 `extract` 加 `signal`/`onConfirmed`/≥1 保底/abort 检查;扩 `ExtractOpts`。
```typescript
// ExtractOpts 扩展
export interface ExtractOpts {
  onProgress?: (done: number, total: number, points: number) => void;
  onConfirmed?: () => void;        // #4:confirm 通过后调(controller 显 loading notice)
  signal?: AbortSignal;
}
export interface ExtractChunkOpts { forceAtLeastOne?: boolean; signal?: AbortSignal; }

// extractChunk 改签名 + try/catch + force prompt + signal 透传
async extractChunk(book: string, chunk: Chunk, prior: { title: string; summary: string }[], opts: ExtractChunkOpts = {}): Promise<BatchPoint[]> {
  const priorBlock = prior.length ? prior.map(p => `- ${p.title} — ${p.summary}`).join("\n") : "(无)";
  const forceLine = opts.forceAtLeastOne
    ? "\n【重要:必须返回至少1条知识点,哪怕内容稀薄也提取最核心的一条。禁止返回空数组。】"
    : "";
  const prompt = `你是知识抽取助手。从下面这段 PDF 文本(来自《${book}》第 ${chunk.pages[0]}-${chunk.pages[chunk.pages.length-1]} 页)提取离散知识点。
每个知识点给:title(简短名词短语)、summary(2-4 句)、source_page(所在页码)、tags(2-3 个主题标签)、related(与本块或前文知识点中相关的标题列表)。
只返回 JSON 数组,不要其他文字:[{"title","summary","source_page","tags","related"}]${forceLine}

【此前已抽取的知识点(只看 schema+摘要,别复述原文)】:
${priorBlock}

文本:${chunk.text}`;
  let raw: string;
  try {
    raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2, signal: opts.signal });
  } catch (e) {
    console.warn(`[shiyue] 块抽取失败(将兜底):${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  const parsed = parseLLMJson<any>(raw);
  const arr: any[] = Array.isArray(parsed) ? parsed
    : (parsed && typeof parsed === "object" ? (Object.values(parsed).find(v => Array.isArray(v)) as any[] | undefined) ?? [] : []);
  const fallbackPage = chunk.pages[0];
  return arr.map(p => normalizePoint(p, fallbackPage)).filter(Boolean) as BatchPoint[];
}
```

```typescript
// extract 改:加 chapters + onConfirmed + signal + 每块≥1 保底
async extract(source: DocumentSource, opts: ExtractOpts = {}): Promise<ExtractResult> {
  const doc = await source.getDocument();
  if (!doc) throw new Error("无法加载 PDF 文档");
  try {
    const file = source.getFile();
    // 1. 每页文本 + 章节边界
    const pages: PageText[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      pages.push({ page: i, text: tc.items.map((it: any) => it.str ?? "").join("") });
    }
    const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
    const chapters = await chapterBoundaries(doc);
    console.log(`[shiyue] 文本:${doc.numPages} 页,${totalChars} 字符;章节边界:${chapters.length ? chapters.join(",") : "(无 outline)"}`);
    // 2. 分块(10k budget + 长文≥3 + 章节对齐)
    const chunks = chunkPages(pages, 10000, 0, chapters);
    console.log(`[shiyue] 分块:${chunks.length} 块`);
    if (chunks.length === 0 || totalChars === 0) {
      return { count: 0, chunks: chunks.length, cancelled: false, message: "PDF 无可抽取文本(可能是扫描件/图片 PDF,pdfjs 取不到文本层)" };
    }
    // 3. 预估 + 确认
    const inputTokens = chunks.reduce((s, c) => s + estimateTokens(c.text) * 1.3, 0);
    const estCost = estimateCost(inputTokens, inputTokens * 0.3, this.pricing);
    if (!(await this.confirmFn(file.basename, chunks.length, Math.round(inputTokens), estCost))) {
      return { count: 0, chunks: chunks.length, cancelled: true, message: "用户取消" };
    }
    opts.onConfirmed?.();  // #4:confirm 通过后 controller 显 loading notice
    // 4. map(每块≥1 保底 + abort 检查)
    let all: BatchPoint[] = [];
    let prior: { title: string; summary: string }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (opts.signal?.aborted) return { count: all.length, chunks: chunks.length, cancelled: true, message: "用户取消" };
      let pts = await this.extractChunk(file.basename, chunks[i], prior, { signal: opts.signal });
      if (pts.length === 0 && !opts.signal?.aborted) {
        pts = await this.extractChunk(file.basename, chunks[i], prior, { forceAtLeastOne: true, signal: opts.signal });
      }
      if (pts.length === 0 && !opts.signal?.aborted) {
        pts = [synthesizePoint(chunks[i])];
        console.log(`[shiyue] 块 ${i + 1}/${chunks.length} 兜底合成 1 点`);
      }
      console.log(`[shiyue] 块 ${i + 1}/${chunks.length} → ${pts.length} 点`);
      all.push(...pts);
      prior = [...prior, ...pts.map(p => ({ title: p.title, summary: p.summary }))].slice(-30);
      opts.onProgress?.(i + 1, chunks.length, all.length);
    }
    if (opts.signal?.aborted) return { count: 0, chunks: chunks.length, cancelled: true, message: "用户取消" };
    // 5. 去重
    const deduped = dedupe(all, 0.8);
    console.log(`[shiyue] 去重:${all.length} → ${deduped.length} 点`);
    // 6. 生成笔记
    for (const p of deduped) {
      const pageText = pages.find(pg => pg.page === p.source_page)?.text ?? "";
      await this.noteGen.generate({
        title: p.title, summary: p.summary, source_pdf: file.basename, source_page: p.source_page,
        source_text: pageText, tags: p.tags, related: p.related,
        model: this.noteOpts.model, extraction_mode: "batch",
      });
    }
    // 7. 状态
    if (this.state) await this.state.record(file.basename, file.path, deduped.map(p => p.title), this.noteOpts.model);
    if (deduped.length === 0) {
      return { count: 0, chunks: chunks.length, cancelled: false, message: `LLM 未返回有效知识点(${chunks.length} 块全空——看控制台每块点数)` };
    }
    return { count: deduped.length, chunks: chunks.length, cancelled: false, message: "抽取完成" };
  } finally {
    await doc.destroy?.();
  }
}
```

- [ ] **Step 4: 跑测试通过 + 不回归** — `node --test --experimental-strip-types src/core/extraction/batch-extractor.test.ts` → 全绿(原 extractChunk 测试 3 参调用仍工作;新 2 个 opts 测试绿)。全量 → 绿。

- [ ] **Step 5: build** — `npm run build` → clean。

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat(shiyue): extractChunk opts(force/signal) + per-chunk>=1 floor + cancel threading (#6 #5 plan-c task3)"
```

---

### Task 4: `SelectionExtractor.extract` 加 `signal`

**Files:** Modify `src/core/extraction/selection-extractor.ts`。

- [ ] **Step 1: 改签名** — `extract(book, selected, page, contextText, existingTitles, signal?: AbortSignal)`,把 `signal` 透传 `llm.chat`。
```typescript
async extract(book: string, selected: string, page: number, contextText: string, existingTitles: string[], signal?: AbortSignal): Promise<SelectionPoint | null> {
  // ...prompt 不变...
  let raw: string;
  try {
    raw = await this.llm.chat([{ role: "user", content: prompt }], { jsonMode: true, temperature: 0.2, signal });
  } catch (e) {
    if (signal?.aborted) return null;  // 取消 → null(controller 不报错)
    throw e;  // 其他错抛出
  }
  const parsed = parseLLMJson<any>(raw);
  if (parsed == null) return null;
  return normalizeSelectionPoint(parsed, page);
}
```

- [ ] **Step 2: 跑现有 selection-extractor 测试** — `node --test --experimental-strip-types src/core/extraction/selection-extractor.test.ts` → 绿(现有调用 5 参,signal undefined;mock chat 忽略 opts)。全量 → 绿。

- [ ] **Step 3: build** — `npm run build` → clean。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(shiyue): SelectionExtractor.extract accepts abort signal (#8 plan-c task4)"
```

---

### Task 5: `ui/loading-notice.ts`(持续 Notice + spinner + Stop)+ styles

**Files:** Create `src/ui/loading-notice.ts`;Modify `styles.css`(加 spinner + loading-notice + 改 logo inline)。

- [ ] **Step 1: 写实现**
```typescript
// src/ui/loading-notice.ts
import { App, Notice } from "obsidian";

/** 持续 Notice:spinner + 文本 + Stop 按钮。Stop → onCancel(controller.abort)。
 *  new Notice(el, 0) 持续不自动隐;update 改文本。batch 经 onConfirmed 显;selection 直接显。 */
export class LoadingNotice {
  private notice: Notice | null = null;
  private textEl: HTMLElement | null = null;

  constructor(private app: App, private label: string, private onCancel: () => void) {}

  show(text?: string): void {
    if (this.notice) { this.update(text ?? ""); return; }
    const root = document.createElement("div");
    root.className = "shiyue-loading-notice";
    root.createEl("span", { cls: "shiyue-spinner" });
    this.textEl = root.createEl("span", { cls: "shiyue-loading-text", text: `${this.label}${text ? " " + text : ""}` });
    const stop = root.createEl("button", { cls: "shiyue-loading-stop", text: "停止" });
    stop.onclick = () => this.onCancel();
    this.notice = new Notice(root, 0);
  }
  update(text: string): void {
    if (this.textEl) this.textEl.setText(`${this.label} ${text}`);
  }
  hide(): void {
    this.notice?.hide();
    this.notice = null;
    this.textEl = null;
  }
}
```

- [ ] **Step 2: 加 styles** — 追加到 `styles.css`(并在 Task 7 把 `.shiyue-logo` 改 inline):
```css
/* 持续 loading Notice(ui/loading-notice.ts) */
.shiyue-loading-notice { display: flex; align-items: center; gap: 0.5rem; }
.shiyue-loading-text { font-size: 0.85rem; }
.shiyue-loading-stop { margin-left: 0.25rem; padding: 0.1rem 0.5rem; font-size: 0.75rem; }
.shiyue-spinner {
  width: 0.9rem; height: 0.9rem; border-radius: 50%;
  border: 2px solid var(--text-muted); border-top-color: transparent;
  display: inline-block; animation: shiyue-spin 0.7s linear infinite;
}
@keyframes shiyue-spin { to { transform: rotate(360deg); } }

/* 图谱 logo(Task 7 改:放 .view-actions 内,inline,不再 absolute) */
.shiyue-logo {
  cursor: pointer; font-size: 1.1rem; opacity: 0.75; user-select: none;
  display: inline-flex; align-items: center; padding: 0 0.25rem;
}
.shiyue-logo:hover { opacity: 1; }
```

- [ ] **Step 3: build** — `npm run build` → clean。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(shiyue): ui/loading-notice (persistent spinner+stop) + spinner styles (#5 #8 plan-c task5)"
```

---

### Task 6: `ExtractionController` 接线(AbortController + LoadingNotice + onConfirmed)

**Files:** Modify `src/workspace/extraction-controller.ts`。

- [ ] **Step 1: 改实现** — batch:onConfirmed 后显 notice + 透传 signal;selection:直接显 notice + 透传 signal + 取消判别。
```typescript
// src/workspace/extraction-controller.ts —— 顶部加 import
import { LoadingNotice } from "../ui/loading-notice.ts";

// extractBatch:把现有 new Notice("抽取中…") 删,改 ctrl + loading + onConfirmed
async extractBatch(file: TFile): Promise<void> {
  const s = this.settings();
  const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
  if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
  const provider = new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey: apiKey as string, model: s.model });
  const noteGen = new NoteGenerator(this.app.vault.adapter as any, { notesPath: s.notesPath, model: s.model });
  const pricing = s.pricing.find(p => p.model === s.model) ?? s.pricing[0];
  const state = new ExtractionState(this.app.vault.adapter as any);
  const ctrl = new AbortController();
  const loading = new LoadingNotice(this.app, "抽取中", () => ctrl.abort());
  const be = new BatchExtractor(this.app, provider, noteGen, { notesPath: s.notesPath, model: s.model }, pricing,
    (book, chunks, tokens, cost) => confirmCost(this.app, { book, chunks, tokens, cost }), state);
  const source = new PdfDocumentSource(file, this.app, this.plugin);
  const r = await be.extract(source, {
    signal: ctrl.signal,
    onConfirmed: () => loading.show(),                                    // #4:confirm 后才显
    onProgress: (d, t, p) => loading.update(`${d}/${t} → ${p} 点`),
  });
  loading.hide();
  if (r.cancelled) { new Notice("已取消", 2000); return; }
  if (r.count > 0) new Notice(`✓ ${r.message}:${r.count} 个知识点(见 ${s.notesPath}/)`, 8000);
  else new Notice(`✗ ${r.message}`, 8000);
}

// extractSelection:加 ctrl + loading(show 在取上下文后、调 LLM 前)+ 透传 signal + 取消判别
async extractSelection(file: TFile, sel: SelInfo): Promise<void> {
  const s = this.settings();
  const apiKey = this.app.secretStorage.getSecret("shiyue-api-key") ?? "";
  if (!apiKey) { new Notice("未配置 API Key,请在设置中添加"); return; }
  const provider = new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey: apiKey as string, model: s.model });
  const source = new PdfDocumentSource(file, this.app, this.plugin);
  const doc = await source.getDocument();
  if (!doc) { new Notice("PDF 未加载完成"); return; }
  const ctrl = new AbortController();
  const loading = new LoadingNotice(this.app, "深抽中", () => ctrl.abort());
  loading.show();   // selection 无 confirm 门,直接显
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
    const se = new SelectionExtractor(provider);
    const point = await se.extract(file.basename, sel.text, sel.page, contextPages.join("\n"), existing, ctrl.signal);
    loading.hide();
    if (ctrl.signal.aborted) { new Notice("已取消", 2000); return; }
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
  } catch (e) {
    loading.hide();
    if (!ctrl.signal.aborted) new Notice(`深抽失败:${e instanceof Error ? e.message : String(e)}`, 8000);
  } finally {
    await doc.destroy?.();
  }
}
```
> 注:extractBatch 里原来开头的 `new Notice("抽取中…(大 PDF 可能需要几十秒)", 4000)` 删掉(被 loading 取代)。其余(provider/noteGen/pricing/state/source 构造)不变。

- [ ] **Step 2: build** — `npm run build` → clean。

- [ ] **Step 3: 人工验**(留到 Task 10 整体)。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(shiyue): ExtractionController wires AbortController+LoadingNotice, onConfirmed gate (#4 #5 #8 plan-c task6)"
```

---

### Task 7: logo 移到视图头栏 `.view-actions`(#2)

**Files:** Modify `src/workspace/shiyue-workspace.ts`(`injectLogos`)。styles.css 在 Task 5 已改 `.shiyue-logo` 为 inline。

- [ ] **Step 1: 改 injectLogos**
```typescript
private injectLogos(): void {
  for (const leaf of this.app.workspace.getLeavesOfType("graph")) {
    const view = leaf.view as unknown as { containerEl?: HTMLElement; contentEl?: HTMLElement };
    const actions = view?.containerEl?.querySelector?.(".view-actions") as HTMLElement | null;
    if (!actions) continue;  // 无头栏动作区 → 不注入(避免 contentEl 浮位与原生控件重叠)
    if (actions.querySelector(`[${SHIYUE_LOGO_ATTR}]`)) continue;
    const btn = actions.createEl("div", { attr: { [SHIYUE_LOGO_ATTR]: "" }, cls: "shiyue-logo" });  // createEl 默认 append → 在「...」左侧前需 prepend
    actions.insertBefore(btn, actions.firstChild);  // prepend → logo 在最左(「...」之左)
    btn.setText("📖");
    btn.onclick = () => { void this.ensureShiyueSplit(); };
  }
}
```
> 注:`createEl` 后用 `insertBefore(btn, firstChild)` 把 logo 挪到动作区最左(「...」more 按钮之左)。若 `.view-actions` 选择器在实测 DOM 里不对(可能 `.view-header-actions` 等),实现者用 DevTools 确认实际选择器再改——以 logo 出现在头栏「...」左侧为准。

- [ ] **Step 2: build** — `npm run build` → clean。

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "fix(shiyue): logo into .view-actions (left of more-options) (#2 plan-c task7)"
```

---

### Task 8: 「在拾阅中打开」同 split 新 tab(#3)

**Files:** Modify `src/workspace/shiyue-workspace.ts`(`openInShiyue`)。

- [ ] **Step 1: 改 openInShiyue**
```typescript
/** 确保 split + 打开 file。preview 有文件 → 同 split 新 tab;preview 空 → 替换。 */
async openInShiyue(file: TFile): Promise<void> {
  await this.ensureShiyueSplit();
  const hasDoc = !!this.tracker.get() && this.isPreviewLeafValid();
  let target: WorkspaceLeaf;
  if (hasDoc) {
    const preview = this.previewLeaf!;
    await this.app.workspace.setActiveLeaf(preview, { focus: false });
    target = this.app.workspace.getLeaf(true) as WorkspaceLeaf;  // active split 新 tab
  } else {
    target = this.previewLeaf!;  // 空 → 替换
  }
  await target.openFile(file);
  this.previewLeaf = target;  // 跟踪最新激活 leaf
  this.attachPreviewCapture();
  this.tracker.set(file);
}
```
> 注:`getLeaf(true)` 在实测里应于 active leaf 的 split 开新 tab。若实测发现开到主根 split(不是右栏),改用 `createLeafInParent(this.previewLeaf!.parent as any, ...)`。以「新 tab 在右栏预览 split、紧邻当前页」为准(Task 10 人工验 #3)。

- [ ] **Step 2: build** — `npm run build` → clean。

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "fix(shiyue): openInShiyue reuses empty preview / new tab in same split (#3 plan-c task8)"
```

---

### Task 9: contextmenu 改 capture 阶段(#7)

**Files:** Modify `src/preview/selection-capture.ts`(attachSelectionCapture 的 contextmenu listener)。

- [ ] **Step 1: 改两行** — contextmenu 的 add/remove 都加第 3 参 `true`(capture)。mouseup 不变(原生不拦它)。
```typescript
// attachSelectionCapture 末尾:
  root.addEventListener("mouseup", onMouseUp);
  root.addEventListener("contextmenu", onContextMenu, true);   // capture:先于原生 viewer 的 bubble handler
  return () => {
    root.removeEventListener("mouseup", onMouseUp);
    root.removeEventListener("contextmenu", onContextMenu, true);
  };
```

- [ ] **Step 2: 跑 selection-capture 测试不回归** — `node --test --experimental-strip-types src/preview/selection-capture.test.ts` → 4 绿(纯 SelectionCache,不受影响)。全量 → 绿。

- [ ] **Step 3: build** — `npm run build` → clean。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "fix(shiyue): contextmenu capture-phase (native viewer stopPropagation bypass) (#7 plan-c task9)"
```

---

### Task 10: 全量验证 + 人工验

- [ ] **Step 1: 全量测试** — `node --test --experimental-strip-types $(find src -name '*.test.ts')` → 之前 59 + Task1 ~9 + Task2 ~5 + Task3 ~2 = 全绿。

- [ ] **Step 2: build** — `npm run build` → clean。

- [ ] **Step 3: 人工验(9 项全过)** — 测试 vault 重载插件:
  1. logo 在图谱视图头栏「...」左侧(不与筛选/颜色组/外观/力度重叠)。
  2. 点 logo → 右侧分两屏。
  3. 右键文件列表 `.pdf`「在拾阅中打开」:preview 空→替换;有文档→同 split 新 tab(不开新窗)。
  4. 点「抽取整篇」→ 预估弹窗 → 点「继续」→ **此时**右上角持续 Notice(spinner + "抽取中 x/t" + 停止)出现(不在弹窗时同时出)。
  5. Notice 持续到抽取结束;点「停止」→ 中止 + Notice 消 + "已取消"。
  6. 77 页长文档:分块数合理(每块≤10k token,长文≥3 块,章节尽量不跨),前几块不再全 0(每块≥1 保底)。看 console 每块点数 + "兜底合成" 日志。
  7. 预览选中文字 → 右键 → 「深抽这个知识点」**出现**(capture 阶段生效)→ 调深抽。
  8. 「选区知识点提取」:持续 "深抽中" Notice + spinner + 停止。
  9. 生成的笔记 frontmatter tags **无划线**(合法 tag,空格→_、去 #/标点)。

  **若某步失败:** 记现象(console + 选择器实测),在 plan 文件 Task 10 下补 `> 人工验(YYYY-MM-DD):…`;失败不阻塞 commit(代码 build clean + 测试绿),下一轮修。

- [ ] **Step 4: Commit(若有 plan 上的验记)**
```bash
git add -A && git commit -m "chore(shiyue): plan-c final verify (tests green, build clean)"
```

---

## 自审

**1. 反馈覆盖:** #1✅(确认不改);#2(Task 7);#3(Task 8);#4(Task 6 onConfirmed);#5(Task 5+6 持续 Notice+spinner+Stop+AbortController);#6(Task 2 分块 + Task 3 每块≥1 保底);#7(Task 9 capture);#8(Task 4 signal + Task 6 selection loading);#9(Task 1 sanitizeTag)。全覆盖。

**2. 占位符:** 无 TBD。`.view-actions` 选择器 + `getLeaf(true)` split 行为标注"实测确认",给了 fallback(`createLeafInParent`)。所有 code step 完整。

**3. 类型一致性:**
- `sanitizeTag`/`splitTag`(Task 1 normalize.ts)→ selection-extractor import 用(Task 1 Step 4)。✅
- `chunkPages(pages, budget, _overlap, chapters?, threshold=10000)`(Task 2)→ extract 调 `chunkPages(pages, 10000, 0, chapters)`(Task 3)。✅
- `synthesizePoint(chunk)`(Task 2)→ extract 调(Task 3)。✅
- `extractChunk(book, chunk, prior, opts?: {forceAtLeastOne?, signal?})`(Task 3)→ extract 调(无 opts / force / signal)。✅ 现有 3 参测试绿。
- `ExtractOpts { onProgress?, onConfirmed?, signal? }`(Task 3)→ controller 调(Task 6)传 `signal/onConfirmed/onProgress`。✅
- `SelectionExtractor.extract(..., signal?)`(Task 4)→ controller 调(Task 6)传 `ctrl.signal`。✅
- `LoadingNotice(app, label, onCancel)`(Task 5)→ controller `new LoadingNotice(app, "抽取中", () => ctrl.abort())`(Task 6)。✅

**4. 风险:**
- `.view-actions` 选择器 / `getLeaf(true)` split 行为:实测 DOM/Obsidian 版本可能差异。给了 fallback + Task 10 人工验 #2/#3 把关。
- `doc.getOutline()`/`getPageIndex` 在 pdfjs-dist v5.4.530 的精确签名:best-effort + try/catch,失败退 [](纯页对齐),不炸。Task 2 测试用 fake doc 覆盖。
- AbortController 取消 LLM in-flight:provider 已支持 signal;取消后 chat 抛 AbortError → extractChunk catch 返回 [] → extract 见 signal.aborted break。selection:catch 返回 null。✅
- tag sanitize 把空格→_:英文多词 tag("machine learning")→"machine_learning"(Obsidian 合法);CJK 无空格不受影响。✅
- 每块≥1 兜底合成:可能产生低质量点(首 40 字作 title)。但优于 0 点;用户可见 console "兜底合成" 日志辨别。✅

**5. 不破坏:** 纯逻辑任务保持现有签名兼容(可选参 + 默认),59 现有测试不回归(Task 1-4 每步跑全量)。obsidian 任务(5-9)改的是 Plan B 新文件,不动 core 行为。✅

---

## 执行交接

Plan C 存于 `docs/superpowers/plans/2026-07-28-plan-c-polish.md`。建议:
- **Task 1-4(纯逻辑,TDD)**:subagent 批量(一个 subagent 顺序 1→2→3→4,每任务 TDD + commit + 全量测试不回归),两阶段 review。
- **Task 5-9(obsidian 耦合)**:inline 执行 + Task 10 人工验(用户跑 Obsidian)。

Task 1-4 subagent + Task 5-9 inline + Task 10 人工验。开始?

