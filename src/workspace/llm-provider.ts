// src/workspace/llm-provider.ts — OpenAI-compatible provider 工厂。
// 集中 apiKey 解析(SecretStorage)+ provider 构造,消除 extraction/synthesis/settings
// 三处复制(Standards review: Duplicated Code + Shotgun Surgery)。统一 SHIYUE_API_KEY_ID
// (controllers 原用字面量、settings-tab 用常量,不一致)。
import type { App } from "obsidian";
import { OpenAICompatibleProvider } from "../core/llm/llm-service.ts";
import type { ShiyueSettings } from "../settings.ts";

/** SecretStorage key id(小写字母+连字符,符合 SecretStorage 约定)。 */
export const SHIYUE_API_KEY_ID = "shiyue-api-key";

/** 取 API key。SecretStorage.getSecret 同步返 string|null;无 key → 空串。 */
export function resolveApiKey(app: App): string {
  return app.secretStorage.getSecret(SHIYUE_API_KEY_ID) ?? "";
}

/** 建 OpenAI-compatible provider。无 key → null(调用方给 Notice / 抛错,与各路径既有行为一致)。
 *  getSecret 同步返 string|null(已验 obsidian.d.ts:5654),故无 `as string` cast 必要。 */
export function buildProvider(app: App, s: ShiyueSettings): OpenAICompatibleProvider | null {
  const apiKey = resolveApiKey(app);
  if (!apiKey) return null;
  return new OpenAICompatibleProvider({ baseURL: s.baseURL, apiKey, model: s.model });
}
