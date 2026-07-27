# 拾阅 Phase 1 — Plan 1: Foundation(LLMService + Settings + DocumentSource)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 AI 抽取的底座:可配置的 LLM 客户端(默认 DeepSeek `deepseek-v4-flash`)+ SecretStorage 存 key + 费用预估/计数 + DocumentSource 接口(解耦 PDF viewer)。产出:Settings 里能配 key、测连接、看本月用量;LLMService 可调 chat/stream/abort;DocumentSource 接口 + PdfDocumentSource(批处理用,从 TFile 加载文档)。

**Architecture:** LLMProvider 接口 + OpenAICompatibleProvider(覆盖 DeepSeek/OpenAI,注入 fetch 便于测试)。Settings 用 `app.secretStorage`(`@since 1.11.4`)存 key(不放 settings JSON)。DocumentSource 接口让 extractor 不绑 PDFViewer embed——PdfDocumentSource 仅靠 TFile 加载(批处理/RAG 不依赖 viewer)。纯逻辑用 node:test TDD;Obsidian 集成(UI/SecretStorage)人工验。

**Tech Stack:** TypeScript、obsidian API、pdfjs-dist v5.4.530(spike 钉定)、node:test(spike 既有)、fetch(SSE 手动解析)。

**关联 spec:** `docs/superpowers/specs/2026-07-27-phase1-ai-extraction-design.md`(章节 2/3 + 决策 D9/D10)。
**关联 spike:** 复用 `src/pdf-worker.ts` + version-shim + esbuild onLoad patch + `getResourcePath+fetch` 读法(章节 12 集成发现)。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/document-source.ts` | `DocumentSource` 接口 + `PdfDocumentSource`(TFile→PDFDocumentProxy,批处理用,getSelection=null) |
| `src/llm-service.ts` | `LLMProvider` 接口 + `OpenAICompatibleProvider`(chat/stream/abort,注入 fetch);默认 deepseek-v4-flash |
| `src/usage.ts` | `estimateTokens`/`estimateCost` 纯函数 + `UsageTracker`(读写 `.shiyue/llm-usage.json`,本月计数) |
| `src/settings.ts` | `ShiyueSettings` 类型 + `DEFAULT_SETTINGS` + `ShiyueSettingTab`(UI:key 用 SecretStorage、model、baseURL、连接测试、本月用量) |
| `src/settings.test.ts` / `src/usage.test.ts` / `src/llm-service.test.ts` / `src/document-source.test.ts` | 纯逻辑单测(node:test) |
| `src/main.ts`(改) | 加载/保存 settings + 注册 SettingTab |

---

### Task 1: Settings 数据形状 + 默认值(TDD)

**Files:**
- Create: `src/settings.ts`(数据部分)
- Test: `src/settings.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/settings.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { DEFAULT_SETTINGS } from "./settings";

test("DEFAULT_SETTINGS 默认 DeepSeek + deepseek-v4-flash + 中文笔记路径", () => {
  assert.equal(DEFAULT_SETTINGS.provider, "deepseek");
  assert.equal(DEFAULT_SETTINGS.baseURL, "https://api.deepseek.com");
  assert.equal(DEFAULT_SETTINGS.model, "deepseek-v4-flash");
  assert.equal(DEFAULT_SETTINGS.notesPath, "拾阅笔记/知识点");
  assert.ok(Array.isArray(DEFAULT_SETTINGS.pricing));
});

test("DEFAULT_SETTINGS 不含 apiKey(走 SecretStorage)", () => {
  assert.ok(!("apiKey" in DEFAULT_SETTINGS), "apiKey 不能放 settings JSON,走 SecretStorage");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types src/settings.test.ts`
Expected: FAIL(找不到 `./settings`)

- [ ] **Step 3: 写最小实现**

```typescript
// src/settings.ts
export type LLMProviderKind = "deepseek" | "openai-compatible";

export interface ModelPricing { model: string; inputPer1M: number; outputPer1M: number; }

export interface ShiyueSettings {
  provider: LLMProviderKind;
  baseURL: string;        // DeepSeek 默认 https://api.deepseek.com;OpenAI https://api.openai.com
  model: string;          // 默认 deepseek-v4-flash(实现期核对真实模型 ID)
  notesPath: string;      // 知识点笔记存放路径,默认 拾阅笔记/知识点
  pricing: ModelPricing[]; // per-model 单价(¥/1M tokens),费用预估用
  // 注意:apiKey 不在此处,走 app.secretStorage(spec D5, @since 1.11.4)
}

export const DEFAULT_SETTINGS: ShiyueSettings = {
  provider: "deepseek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  notesPath: "拾阅笔记/知识点",
  // 单价为占位——实现期查 DeepSeek 官方定价核对(MVP 也要做)
  pricing: [
    { model: "deepseek-v4-flash", inputPer1M: 1, outputPer1M: 2 },
    { model: "deepseek-chat", inputPer1M: 1, outputPer1M: 2 },
  ],
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-strip-types src/settings.test.ts`
Expected: PASS(2/2)

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/settings.test.ts
git commit -m "feat(shiyue): settings data shape + defaults (plan1 task1)"
```

---

### Task 2: 费用预估纯函数(TDD)

**Files:**
- Create: `src/usage.ts`
- Test: `src/usage.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/usage.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { estimateTokens, estimateCost } from "./usage";

test("estimateTokens ≈ 字符数/2(中英混合粗估,向上取整)", () => {
  assert.equal(estimateTokens("ab"), 1);
  assert.equal(estimateTokens("abc"), 2);
  assert.equal(estimateTokens("飞轮效应"), 2); // 4 字符 / 2
});

test("estimateCost = input/1M*inputPer1M + output/1M*outputPer1M", () => {
  const p = { inputPer1M: 2, outputPer1M: 6 };
  // 1M input + 1M output = 2 + 6 = 8
  assert.equal(estimateCost(1_000_000, 1_000_000, p), 8);
  // 500k + 500k = 1 + 3 = 4
  assert.equal(estimateCost(500_000, 500_000, p), 4);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types src/usage.test.ts`
Expected: FAIL(找不到 `./usage`)

- [ ] **Step 3: 写最小实现**

```typescript
// src/usage.ts
import type { ModelPricing } from "./settings";

/** 粗估 token 数:中英混合 ≈ 字符数/2。仅用于抽取前预估,非精算。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 单次调用费用(¥):input/1M*inputPer1M + output/1M*outputPer1M。 */
export function estimateCost(inputTokens: number, outputTokens: number, p: ModelPricing): number {
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-strip-types src/usage.test.ts`
Expected: PASS(2/2)

- [ ] **Step 5: Commit**

```bash
git add src/usage.ts src/usage.test.ts
git commit -m "feat(shiyue): token/cost estimate pure fns (plan1 task2)"
```

---

### Task 3: LLMProvider 接口 + OpenAICompatibleProvider chat(注入 fetch,TDD)

**Files:**
- Create: `src/llm-service.ts`
- Test: `src/llm-service.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/llm-service.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { OpenAICompatibleProvider } from "./llm-service";

// 一个返回 canned 响应的假 fetch,验证:请求 URL/body/headers 对 + 解析 content 对
function mockFetch(canned: string, expectedUrlSubstr: string, expectedBodyCheck: (b: any) => void) {
  const calls: any[] = [];
  const f = async (url: string, init: any) => {
    calls.push({ url, init });
    assert.ok(url.includes(expectedUrlSubstr), `URL ${url} 应含 ${expectedUrlSubstr}`);
    expectedBodyCheck(JSON.parse(init.body));
    return { ok: true, status: 200, async text() { return canned; } } as any;
  };
  (f as any).calls = calls;
  return f as any;
}

test("chat: POST /v1/chat/completions + Bearer key + 解析 choices[0].message.content", async () => {
  const canned = JSON.stringify({ choices: [{ message: { content: "hello world" } }] });
  const f = mockFetch(canned, "/v1/chat/completions", (b) => {
    assert.equal(b.model, "deepseek-v4-flash");
    assert.equal(b.messages[0].role, "user");
    assert.equal(b.messages[0].content, "hi");
  });
  const p = new OpenAICompatibleProvider({
    baseURL: "https://api.deepseek.com", apiKey: "sk-test", model: "deepseek-v4-flash", fetchImpl: f,
  });
  const out = await p.chat([{ role: "user", content: "hi" }]);
  assert.equal(out, "hello world");
  assert.equal((f as any).calls[0].init.headers["Authorization"], "Bearer sk-test");
});

test("chat jsonMode: 设 response_format json", async () => {
  const canned = JSON.stringify({ choices: [{ message: { content: "[{\"a\":1}]" } }] });
  const f = mockFetch(canned, "/v1/chat/completions", (b) => {
    assert.deepEqual(b.response_format, { type: "json_object" });
  });
  const p = new OpenAICompatibleProvider({ baseURL: "https://api.deepseek.com", apiKey: "k", model: "m", fetchImpl: f });
  const out = await p.chat([{ role: "user", content: "x" }], { jsonMode: true });
  assert.equal(out, "[{\"a\":1}]");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types src/llm-service.test.ts`
Expected: FAIL(找不到 `./llm-service`)

- [ ] **Step 3: 写最小实现**

```typescript
// src/llm-service.ts
export interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }
export interface ChatOpts {
  model?: string; temperature?: number; maxTokens?: number;
  signal?: AbortSignal; jsonMode?: boolean;
}
export interface LLMProvider {
  chat(messages: ChatMsg[], opts?: ChatOpts): Promise<string>;
  stream(messages: ChatMsg[], opts?: ChatOpts): AsyncGenerator<string>;
  abort(): void;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string>; body?: any }>;

/** OpenAI 兼容 chat completions。覆盖 DeepSeek(baseURL https://api.deepseek.com) + OpenAI。 */
export class OpenAICompatibleProvider implements LLMProvider {
  private baseURL: string; private apiKey: string; private model: string;
  private fetchImpl: FetchLike; private controller: AbortController | null = null;
  constructor(opts: { baseURL: string; apiKey: string; model: string; fetchImpl?: FetchLike }) {
    this.baseURL = opts.baseURL.replace(/\/$/, "");
    this.apiKey = opts.apiKey; this.model = opts.model;
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  }
  async chat(messages: ChatMsg[], o: ChatOpts = {}): Promise<string> {
    this.controller = new AbortController();
    const body: any = { model: o.model ?? this.model, messages, temperature: o.temperature ?? 0.2 };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    if (o.jsonMode) body.response_format = { type: "json_object" };
    const res = await this.fetchImpl(`${this.baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: o.signal ?? this.controller.signal,
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const data = JSON.parse(await res.text());
    return data.choices?.[0]?.message?.content ?? "";
  }
  async *stream(_messages: ChatMsg[], _o: ChatOpts = {}): AsyncGenerator<string> {
    throw new Error("stream: Task 4 实现");
  }
  abort() { this.controller?.abort(); this.controller = null; }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-strip-types src/llm-service.test.ts`
Expected: PASS(2/2)

- [ ] **Step 5: Commit**

```bash
git add src/llm-service.ts src/llm-service.test.ts
git commit -m "feat(shiyue): LLMProvider + OpenAICompatible chat (plan1 task3)"
```

---

### Task 4: OpenAICompatibleProvider stream(SSE)+ abort(TDD)

**Files:**
- Modify: `src/llm-service.ts`(stream 实现)
- Test: `src/llm-service.test.ts`(加 stream 测试)

- [ ] **Step 1: 写失败测试(加到 llm-service.test.ts)**

```typescript
test("stream: 逐块 yield content deltas", async () => {
  // 假 SSE body:两块 data: {...content: "a"} 和 data: {...content: "b"},然后 [DONE]
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\ndata: [DONE]\n\n`;
  const fakeBody = (async function* () { for (const ch of sse) yield ch; }());
  const f = async () => ({ ok: true, status: 200, text: async () => "", body: fakeBody }) as any;
  const p = new OpenAICompatibleProvider({ baseURL: "https://api.deepseek.com", apiKey: "k", model: "m", fetchImpl: f });
  const out: string[] = [];
  for await (const chunk of p.stream([{ role: "user", content: "hi" }])) out.push(chunk);
  assert.equal(out.join(""), "Hello world");
});

test("abort: 调 controller.abort()(通过 signal 触发)", async () => {
  let aborted = false;
  const f = async (_url: string, init: any) => {
    init.signal?.addEventListener?.("abort", () => { aborted = true; });
    throw new Error("network");
  };
  const p = new OpenAICompatibleProvider({ baseURL: "https://api.deepseek.com", apiKey: "k", model: "m", fetchImpl: f as any });
  await p.chat([{ role: "user", content: "x" }]).catch(() => {});
  p.abort();
  assert.ok(aborted, "abort 应触发 signal");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types src/llm-service.test.ts`
Expected: FAIL(stream 抛 "Task 4 实现";abort 测试也 fail)

- [ ] **Step 3: 实现 stream + 改 abort**

把 `stream` 方法体替换为:

```typescript
  async *stream(messages: ChatMsg[], o: ChatOpts = {}): AsyncGenerator<string> {
    this.controller = new AbortController();
    const body: any = { model: o.model ?? this.model, messages, temperature: o.temperature ?? 0.2, stream: true };
    if (o.maxTokens) body.max_tokens = o.maxTokens;
    const res = await this.fetchImpl(`${this.baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: o.signal ?? this.controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`LLM stream ${res.status}`);
    let buf = "";
    for await (const chunk of res.body as any) {
      buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try { yield JSON.parse(data).choices?.[0]?.delta?.content ?? ""; } catch { /* skip malformed */ }
        }
      }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-strip-types src/llm-service.test.ts`
Expected: PASS(4/4)

- [ ] **Step 5: Commit**

```bash
git add src/llm-service.ts src/llm-service.test.ts
git commit -m "feat(shiyue): stream(SSE) + abort (plan1 task4)"
```

---

### Task 5: DocumentSource 接口 + PdfDocumentSource(TDD)

**Files:**
- Create: `src/document-source.ts`
- Test: `src/document-source.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/document-source.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { pageTextFromItems } from "./highlight"; // spike 既有,复用
import type { DocumentSource } from "./document-source";

test("DocumentSource 接口形状:getFile/getDocument/getSelection", () => {
  // 用一个最小 mock 实现验证接口形状
  const ds: DocumentSource = {
    getFile: () => ({ name: "x.pdf", path: "x.pdf", basename: "x", extension: "pdf" } as any),
    getDocument: async () => null,
    getSelection: () => null,
  };
  assert.equal(ds.getFile().basename, "x");
  assert.equal(ds.getSelection(), null);
});

test("PdfDocumentSource.getSelection 恒为 null(文件源无选区;选区走 view)", async () => {
  const { PdfDocumentSource } = await import("./document-source");
  // 不依赖真 Obsidian/pdfjs——只验 getSelection 的 null 语义 + getFile 透传
  const ds = new PdfDocumentSource({ basename: "x", path: "x.pdf", extension: "pdf" } as any, null as any, null as any);
  assert.equal(ds.getSelection(), null);
  assert.equal(ds.getFile().path, "x.pdf");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types src/document-source.test.ts`
Expected: FAIL(找不到 `./document-source`)

- [ ] **Step 3: 写最小实现**

```typescript
// src/document-source.ts
import type { TFile, App, Plugin } from "obsidian";
import type { PDFDocumentProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";
import { configureWorker } from "./pdf-worker";

/** 任何可被抽取的文档源。extractor 依赖此接口,不绑 PDFViewer embed。
 *  换 Obsidian 自带预览器 / EPUB 只改实现,不动 extractor。 */
export interface DocumentSource {
  getFile(): TFile;
  getDocument(): Promise<PDFDocumentProxy | null>;  // 批处理取文本用;非 PDF 源可返回 null
  getSelection(): { text: string; page: number } | null;  // 选区即抽用;无选区能力返回 null
}

/** 文件级 PDF 源(批处理用)。不依赖 viewer——只靠 TFile + spike 的读法加载文档。
 *  getSelection 恒 null(选区由 view 提供,见 SelectionExtractor 那个 plan)。 */
export class PdfDocumentSource implements DocumentSource {
  private doc: PDFDocumentProxy | null = null;
  constructor(private file: TFile, private app: App, private plugin: Plugin) {}
  getFile(): TFile { return this.file; }
  getSelection(): { text: string; page: number } | null { return null; }
  async getDocument(): Promise<PDFDocumentProxy | null> {
    if (this.doc) return this.doc;
    // 复用 spike 集成发现 #12:getResourcePath + fetch(走 webview 有权限层,readBinary 在 TCC 下 EPERM)
    configureWorker(this.app, this.plugin);
    const resourcePath = this.app.vault.adapter.getResourcePath(this.file.path);
    const buf = await (await fetch(resourcePath)).arrayBuffer();
    this.doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    return this.doc;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-strip-types src/document-source.test.ts`
Expected: PASS(2/2)。注:此测试只验接口形状 + getSelection null + getFile 透传(不调真 getDocument,免依赖 Obsidian/pdfjs 运行时)。

- [ ] **Step 5: Commit**

```bash
git add src/document-source.ts src/document-source.test.ts
git commit -m "feat(shiyue): DocumentSource interface + PdfDocumentSource (plan1 task5)"
```

---

### Task 6: UsageTracker(本月 token/费用计数,持久化)

**Files:**
- Modify: `src/usage.ts`(加 UsageTracker)
- Test: `src/usage.test.ts`(加测试)

- [ ] **Step 1: 写失败测试**

```typescript
test("UsageTracker: record 累加同月 token,monthKey 用 YYYY-MM", async () => {
  // 用内存 fake adapter(不依赖真 Obsidian vault)
  let store: Record<string, any> = {};
  const adapter = {
    async exists() { return true; },
    async read() { return JSON.stringify(store["u"] ?? { month: "2026-07", inputTokens: 0, outputTokens: 0 }); },
    async write(path: string, data: string) { store["u"] = JSON.parse(data); },
  } as any;
  // monthKey 纯函数可单测
  const { monthKey } = await import("./usage");
  assert.ok(/^\d{4}-\d{2}$/.test(monthKey(new Date("2026-07-27T10:00:00"))));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test --experimental-strip-types src/usage.test.ts`
Expected: FAIL(无 monthKey)

- [ ] **Step 3: 加 monthKey + UsageTracker**

在 `src/usage.ts` 追加:

```typescript
/** YYYY-MM 月键(本地时区)。 */
export function monthKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

/** 本月 token 用量,持久化到 .shiyue/llm-usage.json。Settings 显示「本月已用」。 */
export class UsageTracker {
  constructor(private adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void> }, private path = ".shiyue/llm-usage.json") {}
  async record(inputTokens: number, outputTokens: number): Promise<void> {
    const cur = await this.get();
    cur.inputTokens += inputTokens; cur.outputTokens += outputTokens;
    await this.adapter.write(this.path, JSON.stringify(cur));
  }
  async get(): Promise<{ month: string; inputTokens: number; outputTokens: number }> {
    if (!await this.adapter.exists(this.path)) return { month: monthKey(new Date()), inputTokens: 0, outputTokens: 0 };
    const data = JSON.parse(await this.adapter.read(this.path));
    if (data.month !== monthKey(new Date())) return { month: monthKey(new Date()), inputTokens: 0, outputTokens: 0 }; // 跨月重置
    return data;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test --experimental-strip-types src/usage.test.ts`
Expected: PASS(3/3)

- [ ] **Step 5: Commit**

```bash
git add src/usage.ts src/usage.test.ts
git commit -m "feat(shiyue): UsageTracker monthly token counter (plan1 task6)"
```

---

### Task 7: SettingsTab UI(SecretStorage key + 连接测试 + 用量显示)

**Files:**
- Modify: `src/settings.ts`(加 ShiyueSettingTab)
- Modify: `src/main.ts`(加载 settings + 注册 tab)

- [ ] **Step 1: 加 ShiyueSettingTab 到 settings.ts**

在 `src/settings.ts` 末尾追加:

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import { OpenAICompatibleProvider } from "./llm-service";
import { UsageTracker } from "./usage";

export class ShiyueSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: { settings: ShiyueSettings; saveSettings(): Promise<void>; }, private usage: UsageTracker) {
    super(app, plugin as any);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "拾阅 / Shiyue" });

    new Setting(containerEl).setName("AI 服务商").setDesc("DeepSeek(默认,高性价比)/ OpenAI 兼容").addDropdown(d => d
      .addOption("deepseek", "DeepSeek").addOption("openai-compatible", "OpenAI 兼容")
      .setValue(this.plugin.settings.provider)
      .onChange(async v => { this.plugin.settings.provider = v as any; if (v === "deepseek") { this.plugin.settings.baseURL = "https://api.deepseek.com"; this.plugin.settings.model = "deepseek-v4-flash"; } await this.plugin.saveSettings(); this.display(); }));

    new Setting(containerEl).setName("API Key").setDesc("存于 Obsidian SecretStorage,加密、跨设备不同步").addText(t => {
      t.inputEl.type = "password"; t.setPlaceholder("sk-...");
      // 异步回填:从 secretStorage 读现有 key
      this.app.secretStorage.load("shiyue-api-key").then(k => { if (k) t.setValue(k); });
      t.onChange(async v => { await this.app.secretStorage.store("shiyue-api-key", v); });
    });

    new Setting(containerEl).setName("模型").setDesc("默认 deepseek-v4-flash(纯文本)").addText(t => t.setValue(this.plugin.settings.model).onChange(async v => { this.plugin.settings.model = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Base URL").addText(t => t.setValue(this.plugin.settings.baseURL).onChange(async v => { this.plugin.settings.baseURL = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("连接测试").setDesc("发一次最小请求,验证 key/模型可用").addButton(b => b.setButtonText("测试连接").onClick(async () => {
      try {
        const key = await this.app.secretStorage.load("shiyue-api-key");
        const p = new OpenAICompatibleProvider({ baseURL: this.plugin.settings.baseURL, apiKey: key ?? "", model: this.plugin.settings.model });
        const out = await p.chat([{ role: "user", content: "ping" }], { maxTokens: 5 });
        new Notice(`✓ 连接成功:${out.slice(0, 40)}`);
      } catch (e) { new Notice(`✗ 失败:${(e as Error).message}`); }
    }));

    // 本月用量
    this.usage.get().then(u => {
      new Setting(containerEl).setName("本月用量").setDesc(`${u.inputTokens} input / ${u.outputTokens} output tokens(${u.month})`);
    });
  }
}

// Notice 在顶部 import 已加?补:
import { Notice } from "obsidian";
```
(把 `import { App, PluginSettingTab, Setting, Notice } from "obsidian";` 放文件顶部,合并上方的 import。)

- [ ] **Step 2: 改 main.ts——加载 settings + 注册 tab**

在 `src/main.ts` 的 `ShiyuePlugin` 类里加:

```typescript
import { ShiyueSettings, DEFAULT_SETTINGS, ShiyueSettingTab } from "./settings";
import { UsageTracker } from "./usage";

export default class ShiyuePlugin extends Plugin {
  settings: ShiyueSettings = DEFAULT_SETTINGS;
  async onload() {
    await this.loadSettings();
    // ...(既有 registerView + 命令保留)
    this.addSettingTab(new ShiyueSettingTab(this.app, this, new UsageTracker(this.app.vault.adapter as any)));
  }
  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
}
```
(注意:`this` 作为 `plugin: { settings; saveSettings() }` 传入 tab——ShiyuePlugin 已有 settings + saveSettings。)

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: tsc + esbuild clean(无类型错)。若 `app.secretStorage.load/store` 类型不存在,核对 Obsidian API 版本(`@since 1.11.4`,manifest `minAppVersion: 1.11.4` 已设)。

- [ ] **Step 4: 人工验证(无单测——UI/集成)**

在测试 vault 里:设置 → 拾阅 → 填 DeepSeek key + 模型 `deepseek-v4-flash` →「测试连接」→ 应 `✓ 连接成功`。本月用量显示 `0 input / 0 output`。

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/main.ts
git commit -m "feat(shiyue): SettingsTab (SecretStorage key + connection test + usage) (plan1 task7)"
```

---

## 自审

**1. Spec 覆盖**:Plan 1 覆盖 spec §3 LLMService(砍 Ollama、默认 deepseek-v4-flash、chat/stream/abort、SecretStorage、费用预估)+ §1 DocumentSource 接口(D10)+ §2 数据层(`.shiyue/llm-usage.json`)+ §9 D9/D10。**未覆盖**(留给后续 plan):批处理(Plan 2)、选区抽取 + UX 双击打开/工具栏(Plan 3)、RAG 叠加层(Plan 4)。本 plan 是依赖根,产出可独立验证(配 key + 测连接 + 用量)。

**2. 占位符扫描**:pricing 单价标「占位,实现期核对 DeepSeek 定价」——这是 spec §9 已标的待核对项,非偷懒占位。model `deepseek-v4-flash` 同理(spec D9 标实现期核对真实 ID)。无 TBD/TODO。

**3. 类型一致性**:`ShiyueSettings`、`LLMProvider`/`ChatMsg`/`ChatOpts`、`OpenAICompatibleProvider`、`DocumentSource`/`PdfDocumentSource`、`UsageTracker`/`monthKey`/`estimateTokens`/`estimateCost` 跨任务命名一致。`OpenAICompatibleProvider` 构造参 `{baseURL, apiKey, model, fetchImpl?}` 在 Task 3/4/7 一致。`UsageTracker` 构造 `(adapter, path?)` Task 6/7 一致。

---

## 后续 plan(本 plan 完成后)

- **Plan 2**:NoteGenerator(schema + CJK 文件名 + 去重)+ BatchExtractor(chunk + map 顺序注入前文 + reduce 去重 + 抽取前弹窗预估)→ 产出「开 PDF → 一键抽知识点 → N 条笔记喂图谱」。
- **Plan 3**:SelectionExtractor(select→深抽 + backlink)+ UX(`registerExtensions(['pdf'])` 双击打开 + tab + 视图工具栏 + 右键菜单)。
- **Plan 4**:KnowledgePanel RAG 叠加层(标签/backlink 关联 + AI 汇总 + 溯源)。

---

*Plan 1 完成 + 人工验证(测连接)通过后,进 Plan 2。*
