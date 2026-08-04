// src/core/llm/usage.ts
import type { ModelPricing } from "../../settings.ts";
import { ensureFolder, dirOf } from "../fs/vault-fs.ts";

/** 粗估 token 数:中英混合 ≈ 字符数/2。仅用于抽取前预估,非精算。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

/** 单次调用费用(¥):input/1M*inputPer1M + output/1M*outputPer1M。 */
export function estimateCost(inputTokens: number, outputTokens: number, p: Pick<ModelPricing, "inputPer1M" | "outputPer1M">): number {
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
}

/** YYYY-MM 月键(本地时区)。 */
export function monthKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

/** 本月 token 用量,持久化到 .shiyue/llm-usage.json。Settings 显示「本月已用」。 */
export class UsageTracker {
  private adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void> };
  private path: string;
  constructor(adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void> }, path = ".shiyue/llm-usage.json") {
    this.adapter = adapter; this.path = path;
  }
  async record(inputTokens: number, outputTokens: number): Promise<void> {
    const cur = await this.get();
    cur.inputTokens += inputTokens; cur.outputTokens += outputTokens;
    await ensureFolder(this.adapter, dirOf(this.path));  // 首次写 .shiyue/ 不存在 → ENOENT,先建
    await this.adapter.write(this.path, JSON.stringify(cur));
  }
  async get(): Promise<{ month: string; inputTokens: number; outputTokens: number }> {
    if (!await this.adapter.exists(this.path)) return { month: monthKey(new Date()), inputTokens: 0, outputTokens: 0 };
    const data = JSON.parse(await this.adapter.read(this.path));
    if (data.month !== monthKey(new Date())) return { month: monthKey(new Date()), inputTokens: 0, outputTokens: 0 }; // 跨月重置
    return data;
  }
}
