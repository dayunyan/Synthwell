// src/workspace/chat-message.ts — 聊天消息协议(discriminated union)+ 纯辅助。
// 纯逻辑、不 import obsidian(node:test 可加载单测):消息类型定义 + 自动滚动粘底判定 +
// 消息 id 生成。DOM 渲染与 per-message Component 生命周期在 ai-panel-view.ts(视图拥有)。
//
// 三种消息类型(spec §3):每条消息一个 Component(D6 per-message load/unload 防泄漏)。
//  - user-action:按钮触发的动作(右对齐用户气泡)。
//  - agent-reply:tool 输出(streaming 期 markdown 增长 + 停止按钮;streaming=false 后
//    停止按钮消失,汇总则 affordance:'save' 显存回按钮)。
//  - error:tool 失败(红底,无 streaming/save)。

/** 消息 id 生成器:单调递增计数(确定性,不用 Math.random/Date —— 利于测/稳)。 */
let messageIdSeq = 0;
export function newMessageId(): string {
  messageIdSeq += 1;
  return `m${messageIdSeq}`;
}

/** 用户动作消息:按钮触发的动作(「提炼选中要点」/「汇总关联笔记」/「存回笔记」)。右对齐。 */
export interface UserActionMessage {
  id: string;
  kind: "user-action";
  /** 动作标签(按钮文案,如「存回笔记」)。 */
  label: string;
  /** 可选图标名(Obsidian icon)。 */
  icon?: string;
}

/** Agent 回复消息:tool 输出。streaming 期 markdown 增长 + 停止按钮;streaming=false 停止按钮消失。 */
export interface AgentReplyMessage {
  id: string;
  kind: "agent-reply";
  /** markdown 内容(MarkdownRenderer 渲染;streaming 期随 chunk 累积)。 */
  markdown: string;
  /** 是否仍在流式产出。true 显停止按钮 + --streaming 光标;false 隐藏停止按钮。 */
  streaming: boolean;
  /** 停止回调(streaming 期显的停止按钮调,即 abort 汇总)。 */
  stop?: () => void;
  /** 流式完成后显的 affordance(目前仅 'save' —— 汇总存回笔记)。 */
  affordance?: "save";
  /** 解析本回复内 `[[笔记]]` 链接的源路径(getFirstLinkpathDest 第二参,相对解析)。 */
  sourcePath?: string;
}

/** 错误消息:tool 失败(替换面板路径 Notice)。红底,无 streaming/save。 */
export interface ErrorMessage {
  id: string;
  kind: "error";
  /** 错误文案(已 i18n)。 */
  message: string;
}

/** 聊天消息(discriminated union,per-message `kind` 分发渲染)。 */
export type ChatMessage = UserActionMessage | AgentReplyMessage | ErrorMessage;

/** 判定是否「粘底」——scroll 距底 ≤ threshold 即真(新内容应自动滚到底)。
 *  用户上滚超过 threshold → 假(暂停自动滚,直到回到底)。容器无溢出 → 恒真。
 *  纯函数,可单测;视图在 scroll 事件 + 新内容追加时调此决定是否 scrollToBottom。 */
export function shouldStickToBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold: number,
): boolean {
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  if (distanceFromBottom <= 0) return true;       // 无溢出 / 恰在底
  return distanceFromBottom <= threshold;
}
