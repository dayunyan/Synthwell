// src/workspace/agent-reply-entry.ts — 消息条目(per-message `Component` 生命周期)。
//
// Std #9(Divergent Change):从 ai-panel-view.ts 拆出,对齐已有的 chat-message.ts(类型)/
// extraction-messages.ts(提取消息)拆分。ai-panel-view.ts 变薄,只留面板壳 + 消息分发 + 按钮门控 +
// 流式生命周期编排;per-message 渲染循环(markdown 去重/串行/renderGen 自废 + decoratePageJumps)在此。
//
// 三类条目(对应 chat-message.ts 的三种消息 kind):
//  - MessageEntry(abstract 基类):持 DOM 元素 + unload 生命周期。
//  - StaticEntry:user-action / error 静态条目(无 markdown 渲染,无 Component)。
//  - AgentReplyEntry:agent-reply 条目 —— MarkdownRenderer per-message Component + 去重/串行/renderGen
//    自废渲染循环(防泄漏 spec D6)。streaming 期显停止按钮 + --streaming 光标;streaming=false 显
//    affordance:'save' 按钮(若有)。`[[笔记]](pN)` 的 (pN) 每次渲染后包成可点 `.shiyue-page-jump` span。
//
// 依赖经构造注入(App / AgentReplyMessage 类型 / onRendered / onSave),无新逻辑,纯搬运。

import { MarkdownRenderer, Component, type App } from "obsidian";
import { t } from "../i18n/index.ts";
import type { AgentReplyMessage } from "./chat-message.ts";

/** 消息条目基类:持 DOM 元素 + unload 生命周期。 */
export abstract class MessageEntry {
  constructor(readonly el: HTMLElement) {}
  unload(): void { /* 静态消息无 Component,无卸载 */ }
}

/** user-action / error 静态条目(无 markdown 渲染,无 Component)。 */
export class StaticEntry extends MessageEntry {}

/** agent-reply 条目:MarkdownRenderer per-message Component + 去重/串行/renderGen 自废渲染循环
 *  (复用原 scheduleRender 模式,但作用于本条 contentEl 而非单 synthEl,防泄漏 D6)。
 *  streaming 期显停止按钮 + --streaming 光标;streaming=false 显 affordance:'save' 按钮(若有)。
 *  `[[笔记]](pN)` 的 (pN) 在每次渲染后包成可点 `.shiyue-page-jump` span(decoratePageJumps,方案 a)。 */
export class AgentReplyEntry extends MessageEntry {
  private readonly contentEl: HTMLElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private comp: Component | null = null;
  private renderChain: Promise<void> = Promise.resolve();
  private renderGen = 0;
  private active = false;
  markdown: string;
  private sourcePath: string;
  private streaming: boolean;
  private affordance?: "save";
  private stopFn?: () => void;

  constructor(
    private readonly app: App,
    msg: AgentReplyMessage,
    private readonly onRendered: () => void,
    private readonly onSave: (replyId: string) => void,
  ) {
    const el = document.createElement("div");
    el.className = "shiyue-msg shiyue-msg--agent";
    super(el);
    this.markdown = msg.markdown;
    this.sourcePath = msg.sourcePath ?? "";
    this.streaming = msg.streaming;
    this.affordance = msg.affordance;
    this.stopFn = msg.stop;
    el.dataset.shiyueSource = this.sourcePath;

    this.contentEl = this.el.createDiv({ cls: "shiyue-msg-content" });
    this.stopBtn = this.el.createEl("button", { cls: "shiyue-msg-stop", text: t("loading.stop") });
    this.saveBtn = this.el.createEl("button", { cls: "shiyue-msg-save", text: t("panel.btn.saveSynth") });
    this.stopBtn.onclick = () => this.stopFn?.();
    this.saveBtn.onclick = () => this.onSave(msg.id);
    this.syncControls();
    this.setMarkdown(msg.markdown, this.sourcePath);
  }

  /** 更新流式/affordance/stop 状态(不重渲 markdown)。 */
  update(patch: { streaming?: boolean; stop?: () => void; affordance?: "save" }): void {
    if (patch.streaming !== undefined) this.streaming = patch.streaming;
    if (patch.stop !== undefined) this.stopFn = patch.stop;
    if (patch.affordance !== undefined) this.affordance = patch.affordance;
    this.syncControls();
  }

  /** 流式渲染调度:去重 + 串行化。rapid 帧合并——只渲最新 markdown,旧 Component unload 防泄漏。
   *  renderGen 让 unload 后的 in-flight 渲染自废。每帧 Component 手动 load/unload(不 addChild
   *  到视图,避免累积死 child);条目 unload 兜底。 */
  setMarkdown(md: string, sourcePath: string): void {
    this.markdown = md;
    this.sourcePath = sourcePath;
    this.el.dataset.shiyueSource = sourcePath;
    if (this.active) return;  // 已有渲染在跑,链尾取最新值
    this.active = true;
    const gen = this.renderGen;
    this.renderChain = this.renderChain.then(async () => {
      try {
        while (gen === this.renderGen) {
          const m = this.markdown, p = this.sourcePath;
          this.unloadComp();
          const comp = new Component();
          this.comp = comp;
          this.contentEl.empty();
          await MarkdownRenderer.render(this.app, m, this.contentEl, p, comp);
          comp.load();
          this.decoratePageJumps();
          this.onRendered();
          if (gen !== this.renderGen) break;     // 已被 unload
          if (this.markdown === m) break;         // 无更新的帧 → 结束
        }
      } catch {
        // MarkdownRenderer.render 不应抛;吞掉保活 renderChain
      } finally {
        if (gen === this.renderGen) this.active = false;
      }
    });
  }

  /** 同步停止/保存按钮 + --streaming 类的显隐。 */
  private syncControls(): void {
    this.el.toggleClass("shiyue-msg--streaming", this.streaming);
    this.stopBtn.hidden = !this.streaming;
    this.stopBtn.disabled = !this.streaming;
    this.saveBtn.hidden = this.streaming || this.affordance !== "save";
  }

  /** unload 当前渲染 Component(防泄漏)。 */
  private unloadComp(): void {
    this.comp?.unload();
    this.comp = null;
  }

  /** MarkdownRenderer 渲完后,把 `[[笔记]](pN)` 里的 `(pN)` 文本节点包成独立可点
   *  `.shiyue-page-jump` span(#07 两个 affordance 的 fiddly 部分,方案 a post-process DOM)。 */
  private decoratePageJumps(): void {
    const links = Array.from(this.contentEl.querySelectorAll<HTMLAnchorElement>("a.internal-link"));
    for (const a of links) {
      const sib = a.nextSibling;
      if (!sib || sib.nodeType !== Node.TEXT_NODE) continue;
      const data = (sib as Text).data;
      const m = /^(\s*)\(p(\d+)\)/.exec(data);
      if (!m) continue;
      const leading = m[1];
      const matched = m[0].slice(leading.length);  // "(pN)"
      const rest = data.slice(m[0].length);
      const parent = a.parentElement;
      if (!parent) continue;
      const span = document.createElement("span");
      span.className = "shiyue-page-jump";
      span.dataset.href = a.dataset.href ?? "";
      span.dataset.page = m[2];
      span.textContent = matched;
      const frag = document.createDocumentFragment();
      if (leading) frag.appendChild(document.createTextNode(leading));
      frag.appendChild(span);
      if (rest) frag.appendChild(document.createTextNode(rest));
      parent.replaceChild(frag, sib);
    }
  }

  unload(): void {
    this.renderGen++;
    this.unloadComp();
    this.active = false;
  }
}
