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
