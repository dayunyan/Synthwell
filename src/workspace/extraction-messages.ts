// src/workspace/extraction-messages.ts — 提取迁移到消息:纯 seam(无 obsidian,node:test 可加载)。
//
// #04:提取(extractBatch/extractSelection)的进度与结果从 LoadingNotice+Notice 迁移到消息协议。
// controller 不直接渲染消息(保持无 UI 依赖):它跑提取、返 ExtractionResult;面板据回调钩子
// (ExtractionHandlers)与结果用这些纯函数转消息。命令面板路径(无 handlers)controller 仍走 Notice。
//
// 三态结果映射面板动作:success/cancelled → 终态化 streaming reply(文本换成 result.message);
// fail → 终态化 reply(保留末帧)+ 追加 error 消息。i18n:#04 气泡专用 extract.msg.*(batchDone/
// selectionDone/selectionWorking)适配消息上下文;进度复用 extract.progress,取消复用 extract.cancelled。

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

/** selection streaming reply 进行中文本:#04 气泡专用 extract.msg.selectionWorking「精读中…」
 *  (区别命令路径 LoadingNotice 标签 extract.selectionLabel「精读中」)。 */
export function selectionWorkingMarkdown(): string {
  return t("extract.msg.selectionWorking");
}

/** batch 成功终态文案:#04 气泡专用 extract.msg.batchDone「✓ 已抽 N 个知识点,已入库到 notesPath」。
 *  controller 两路径(面板消息 / 命令 Notice)共用此构造,面板据 result.message 终态化 reply。 */
export function batchSuccessMarkdown(count: number, notesPath: string): string {
  return t("extract.msg.batchDone", { count, notesPath });
}

/** selection 成功终态文案:#04 气泡专用 extract.msg.selectionDone「✓ 已提炼:{title}」。 */
export function selectionSuccessMarkdown(title: string): string {
  return t("extract.msg.selectionDone", { title });
}

/** ExtractionResult → 终态回复/错误二分(success/cancelled → reply;fail → error)。
 *  仅 `finalizeExtractionActions` 内部用(去导出:Speculative Generality)。 */
type ExtractionTerminal =
  | { kind: "reply"; markdown: string }
  | { kind: "error"; message: string };

/** 据 ExtractionResult 决定终态二分。success/cancelled → reply;fail → error。 */
function extractionTerminal(r: ExtractionResult): ExtractionTerminal {
  if (r.kind === "fail") return { kind: "error", message: r.message };
  return { kind: "reply", markdown: r.message };
}

/** 面板终态化动作(判别联合:合法组合编码进类型,替代三可选 string + docstring 不变式,Primitive Obsession)。
 *  面板执行 DOM,决策在此可单测(无 obsidian)。
 *  - finalize-reply:已有 streaming reply + reply 类终态(success/cancelled)→ 终态化它(换 markdown,摘 stop)。
 *  - finalize-reply-and-error:已有 streaming reply + fail → 终态化它(保留末帧进行中文本)+ 追加 error 消息。
 *  - append-error:无 streaming reply + fail(early check 失败,onConfirmed/onBegin 未触)→ 追加 error 消息。
 *  - silent:无 streaming reply + cancelled(confirmCost 门前撤回,user-action 亦未显)→ 无动作。
 *  原「无 streaming reply + success」防御 appendTerminalReply 路径不可达(success 必在 onConfirmed/onBegin
 *  后,故必有 streaming reply)→ 消去为 silent。 */
export type ExtractionFinalizeActions =
  | { kind: "finalize-reply"; markdown: string }
  | { kind: "finalize-reply-and-error"; markdown: string; error: string }
  | { kind: "append-error"; error: string }
  | { kind: "silent" };

/** 据 hasStreamingReply + ExtractionResult 算终态动作。纯函数,面板据此执行 DOM。 */
export function finalizeExtractionActions(hasStreamingReply: boolean, r: ExtractionResult): ExtractionFinalizeActions {
  const term = extractionTerminal(r);
  if (hasStreamingReply) {
    // 已有 streaming reply:终态化它。reply 类 → 换成终态文案;fail → 保留末帧(进行中文本),error 另追加。
    if (term.kind === "error") return { kind: "finalize-reply-and-error", markdown: selectionWorkingMarkdown(), error: term.message };
    return { kind: "finalize-reply", markdown: term.markdown };
  }
  // 无 streaming reply:early check 失败(无 onConfirmed/onBegin)或 confirmCost 门前撤回。
  if (term.kind === "error") return { kind: "append-error", error: term.message };
  // cancelled 于 confirmCost 门前(user 撤回,user-action 亦未显)→ 静默;
  // success 无 streaming reply 不可达(原防御 appendTerminalReply 路径消去)→ 静默。
  return { kind: "silent" };
}
