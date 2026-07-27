// src/settings.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { DEFAULT_SETTINGS } from "./settings.ts";

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
