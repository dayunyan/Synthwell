// src/usage.ts
import type { ModelPricing } from "./settings.ts";

/** 粗估 token 数:中英混合 ≈ 字符数/2。仅用于抽取前预估,非精算。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 单次调用费用(¥):input/1M*inputPer1M + output/1M*outputPer1M。 */
export function estimateCost(inputTokens: number, outputTokens: number, p: Pick<ModelPricing, "inputPer1M" | "outputPer1M">): number {
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
}
