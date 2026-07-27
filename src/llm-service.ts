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
