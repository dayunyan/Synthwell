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
    // Bind to globalThis — storing globalThis.fetch as a bare ref detaches it from
    // window, causing "Illegal invocation" at call time. .bind keeps the window ctx.
    // (Tests inject fetchImpl so this default only matters in production.)
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch.bind(globalThis) as FetchLike);
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
    if (!res.ok) throw new Error(`LLM stream ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error(`LLM stream ${res.status}: empty body`);
    let buf = "";
    for await (const chunk of res.body as any) {
      buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      // 规范化 CRLF → LF:真实 SSE(部分代理)用 \r\n\r\n 分隔事件,\r\n 行分隔,
      // 不含字面 \n\n,直接 indexOf("\n\n") 会吞掉整段。先归一化。
      buf = buf.replace(/\r\n/g, "\n");
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
  abort() { this.controller?.abort(); this.controller = null; }
}
