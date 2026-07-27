// src/llm-service.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { OpenAICompatibleProvider } from "./llm-service.ts";

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
