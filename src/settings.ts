// src/settings.ts
export type LLMProviderKind = "deepseek" | "openai-compatible";

export interface ModelPricing { model: string; inputPer1M: number; outputPer1M: number; }

export interface ShiyueSettings {
  provider: LLMProviderKind;
  baseURL: string;        // DeepSeek 默认 https://api.deepseek.com;OpenAI https://api.openai.com
  model: string;          // 默认 deepseek-v4-flash(实现期核对真实模型 ID)
  notesPath: string;      // 知识点笔记存放路径,默认 拾阅笔记/知识点
  synthesisPath: string;  // 综合笔记存放路径(ADR-0006),默认 拾阅笔记/汇总
  pricing: ModelPricing[]; // per-model 单价(¥/1M tokens),费用预估用
  // 注意:apiKey 不在此处,走 app.secretStorage(spec D5, @since 1.11.4)
}

export const DEFAULT_SETTINGS: ShiyueSettings = {
  provider: "deepseek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  notesPath: "拾阅笔记/知识点",
  synthesisPath: "拾阅笔记/汇总",
  // 单价为占位——实现期查 DeepSeek 官方定价核对(MVP 也要做)
  pricing: [
    { model: "deepseek-v4-flash", inputPer1M: 1, outputPer1M: 2 },
    { model: "deepseek-chat", inputPer1M: 1, outputPer1M: 2 },
  ],
};
