// src/usage.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { estimateTokens, estimateCost } from "./usage.ts";

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

test("UsageTracker: record 累加同月 token,monthKey 用 YYYY-MM", async () => {
  // 用内存 fake adapter(不依赖真 Obsidian vault)
  let store: Record<string, any> = {};
  const adapter = {
    async exists() { return true; },
    async read() { return JSON.stringify(store["u"] ?? { month: "2026-07", inputTokens: 0, outputTokens: 0 }); },
    async write(path: string, data: string) { store["u"] = JSON.parse(data); },
  } as any;
  // monthKey 纯函数可单测
  const { monthKey } = await import("./usage.ts");
  assert.ok(/^\d{4}-\d{2}$/.test(monthKey(new Date("2026-07-27T10:00:00"))));
});

test("UsageTracker: record 累加 + get 回读同月累计", async () => {
  let store: Record<string, any> = {};
  const adapter = {
    async exists() { return "u" in store; },
    async read() { return JSON.stringify(store["u"]); },
    async write(_p: string, data: string) { store["u"] = JSON.parse(data); },
  } as any;
  const { UsageTracker } = await import("./usage.ts");
  const t = new UsageTracker(adapter);
  await t.record(100, 50);
  await t.record(200, 10);
  const u = await t.get();
  assert.equal(u.inputTokens, 300);
  assert.equal(u.outputTokens, 60);
});

test("UsageTracker: 跨月重置(month 不匹配归零)", async () => {
  let store = { u: { month: "2025-12", inputTokens: 9999, outputTokens: 9999 } };
  const adapter = {
    async exists() { return true; },
    async read() { return JSON.stringify(store["u"]); },
    async write() {},
  } as any;
  const { UsageTracker } = await import("./usage.ts");
  const t = new UsageTracker(adapter);
  const u = await t.get();  // current month != 2025-12
  assert.equal(u.inputTokens, 0);
  assert.equal(u.outputTokens, 0);
  assert.notEqual(u.month, "2025-12");
});

test("UsageTracker.record: 首次写前 mkdir .shiyue(同 ExtractionState 的 ENOENT 回归)", async () => {
  const mkdirs: string[] = [];
  const store: Record<string, any> = {};
  const adapter = {
    async exists(p: string) { return p in store; },
    async read(p: string) { return JSON.stringify(store[p] ?? {}); },
    async write(p: string, data: string) { store[p] = JSON.parse(data); },
    async mkdir(p: string) { mkdirs.push(p); store[p] = {}; },
  } as any;
  const { UsageTracker } = await import("./usage.ts");
  const t = new UsageTracker(adapter);
  await t.record(100, 50);
  assert.ok(mkdirs.includes(".shiyue"), "首次写应先 mkdir .shiyue");
  const u = await t.get();
  assert.equal(u.inputTokens, 100);
});
