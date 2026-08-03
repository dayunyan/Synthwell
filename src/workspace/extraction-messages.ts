// src/workspace/extraction-messages.ts — 提取迁移到消息:纯 seam(无 obsidian,node:test 可加载)。
//
// #04:提取(extractBatch/extractSelection)的进度与结果从 LoadingNotice+Notice 迁移到消息协议。
// controller 不直接渲染消息(保持无 UI 依赖):它跑提取、返 ExtractionResult;面板据回调钩子
// (ExtractionHandlers)与结果用这些纯函数转消息。命令面板路径(无 handlers)controller 仍走 Notice。
//
// 三态结果映射面板动作:success/cancelled → 终态化 streaming reply(文本换成 result.message);
// fail → 终态化 reply(保留末帧)+ 追加 error 消息。batch 进度复用 extract.progress;selection 进行中
// 复用 extract.selectionLabel。i18n key 复用现有 extract.*(issue #04:适配消息上下文,不新增 key)。

import { t } from "../i18n/index.ts";

/** 面板路径提取回调(controller 据 handlers 转消息;命令面板路径不传 → controller 退回 Notice)。
 *  - signal:面板持 AbortController,气泡内停止按钮调 abort;controller 透传给 extractor。
 *  - onConfirmed(total):batch confirmCost 通过后调 → 面板 append streaming reply「0/total」+ 显停止按钮。
 *  - onBegin:selection 无 confirm 门,early check 通过后调 → 面板 append streaming reply「精读中…」。
 *  - onProgress(done,total,points):batch 每块开始/结束调 → 面板更新 reply 文本。 */
export interface ExtractionHandlers {
  signal: AbortSignal;
  onConfirmed?(total: number): void;
  onBegin?(): void;
  onProgress?(done: number, total: number, points: number): void;
}

/** 提取终态结果(controller 返,面板据 kind 决定终态消息动作)。 */
export interface ExtractionResult {
  cancelled: boolean;
  /** success=成功(已抽/已提炼);cancelled=用户停止或 confirm 门取消;fail=空结果/early check 失败。 */
  kind: "success" | "cancelled" | "fail";
  /** 终态文案(已 i18n;success/cancelled → reply markdown;fail → error 消息)。 */
  message: string;
}

/** batch streaming reply 进度文本:复用 extract.progress「{done}/{total} → {points} 点」。 */
export function batchProgressMarkdown(done: number, total: number, points: number): string {
  return t("extract.progress", { done, total, points });
}

/** selection streaming reply 进行中文本:复用 extract.selectionLabel「精读中」。 */
export function selectionWorkingMarkdown(): string {
  return t("extract.selectionLabel");
}

/** 面板终态动作:success/cancelled → 终态化 reply(markdown=result.message);fail → error 消息。 */
export type ExtractionTerminal =
  | { kind: "reply"; markdown: string }
  | { kind: "error"; message: string };

/** 据 ExtractionResult 决定面板终态动作。success/cancelled → reply;fail → error。 */
export function extractionTerminal(r: ExtractionResult): ExtractionTerminal {
  if (r.kind === "fail") return { kind: "error", message: r.message };
  return { kind: "reply", markdown: r.message };
}
