// src/workspace/ai-panel-view.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, Component, type App } from "obsidian";
import type { PanelActions } from "./shiyue-workspace.ts";
import type { PanelContext } from "./panel-context.ts";
import { confirmOverwriteSynthesis } from "../ui/confirm-modal.ts";
import { t } from "../i18n/index.ts";
import {
  newMessageId,
  shouldStickToBottom,
  type ChatMessage,
  type AgentReplyMessage,
} from "./chat-message.ts";
import {
  batchProgressMarkdown,
  selectionWorkingMarkdown,
  extractionTerminal,
  type ExtractionHandlers,
  type ExtractionResult,
} from "./extraction-messages.ts";

export const SHIYUE_AI_PANEL_VIEW = "shiyue-ai-panel";

/** 自动滚动粘底阈值(px):距底 ≤ 此值视为「在底」,新内容自动滚到底。 */
const STICK_THRESHOLD = 24;

/** 拾阅 AI 面板:聊天式宿主 shell —— 消息流(messagesEl)+ 按钮排(buttonRowEl,按需按钮,
 *  门控逻辑 slice 03)+ 输入框(inputEl,v1 禁用占位「聊天 Agent(待实现)」)。
 *
 *  3 种消息类型(discriminated union,per-message `Component` 生命周期,防泄漏 spec D6):
 *   - user-action:按钮触发的动作(右对齐用户气泡)。
 *   - agent-reply:tool 输出(streaming 期 markdown 增长 + 气泡内停止按钮;streaming=false 后
 *     停止按钮消失,汇总则 affordance:'save' 显存回按钮)。
 *   - error:tool 失败(红底,替换面板路径 Notice)。
 *
 *  汇总流式 = 单条 agent-reply 增长(复用 scheduleRender 去重/串行/renderGen 自废模式,但
 *  per-message Component 而非单 synthEl)。停止按钮在气泡内(替换 LoadingNotice 的 stop)。
 *  streaming=false 后 affordance:'save' 出现 → 点 → user-action + agent-reply(「已存为综合笔记」)
 *  消息对,调 slice 01 的 saveSynthesisAsNote。消息跨上下文切换持久(renderContext 只重渲
 *  buttonRowEl,不清 messagesEl)。新消息自动滚到底,用户上滚暂停直到回到底。无消息数量上限。
 *
 *  提取此 slice 仍走 Notice(暂时不对称,slice 04 迁移)。 */
export class AiPanelView extends ItemView {
  private actions: PanelActions;
  private messagesEl!: HTMLElement;
  private buttonRowEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private detachContext: (() => void) | null = null;
  private detachSelection: (() => void) | null = null;
  private detachExtracting: (() => void) | null = null;

  /** #03 按钮排门控状态:hasSelection(选区有无,驱动「提炼选中要点」disabled)/
   *  extracting(深抽进行中,整排 disabled)。currentButtons + selBtn 随 renderContext 重建。 */
  private hasSelection = false;
  private extracting = false;
  private currentButtons: HTMLButtonElement[] = [];
  private selBtn: HTMLButtonElement | null = null;

  /** 消息模型(id → 渲染条目)。每条 agent-reply 自持 Component;user-action/error 仅静态 DOM。 */
  private entries = new Map<string, MessageEntry>();

  /** 自动滚动粘底状态:真 → 新内容/渲染后自动滚到底;用户上滚超阈值 → 假,回到底恢复真。 */
  private stickToBottom = true;

  // ---- 汇总流式状态(单条 streaming agent-reply)----
  private synthAbort: AbortController | null = null;
  private synthReplyId: string | null = null;   // 当前 streaming 汇总回复的 message id
  /** 每条汇总回复 → 其触发知识点笔记(存回用)。按 replyId 绑定,防新汇总启动后旧回复存错文件。 */
  private saveTargets = new Map<string, TFile>();

  // ---- 提取流式状态(单条 streaming agent-reply,#04)----
  /** 在飞提取的 AbortController(气泡内停止按钮调 abort;controller 透传给 extractor)。
   *  null = 无在飞提取。一次仅一条在飞(按钮排门控整排 disabled)。 */
  private extractAbort: AbortController | null = null;
  /** 当前在飞提取回复的 message id(终态化 / 上下文切换打断时用)。 */
  private extractReplyId: string | null = null;

  constructor(leaf: WorkspaceLeaf, actions: PanelActions) {
    super(leaf);
    this.actions = actions;
  }

  getViewType(): string { return SHIYUE_AI_PANEL_VIEW; }
  getDisplayText(): string { return t("panel.displayText"); }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("shiyue-ai-panel");

    // 布局:消息流(滚,flex:1)+ 按钮排 + 禁用输入框(spec §6 标准聊天布局)。
    this.messagesEl = c.createDiv({ cls: "shiyue-ai-messages" });
    this.buttonRowEl = c.createDiv({ cls: "shiyue-ai-button-row" });
    this.inputEl = c.createEl("input", {
      cls: "shiyue-ai-input",
      attr: { type: "text", disabled: "", placeholder: t("panel.chatPlaceholder") },
    });

    // 视图关闭兜底 unload 所有消息 Component(防泄漏 spec D6)。
    this.register(() => this.unloadAllEntries());

    // 消息流滚动 → 更新粘底状态(用户上滚超阈值 → 暂停自动滚;回到底 → 恢复)。
    this.messagesEl.addEventListener("scroll", this.onMessagesScroll);

    // capture 阶段先于 Obsidian 原生 link-open:消息内 [[笔记]] 链接 → 预览区开;
    // (pN) → 开源 PDF 跳页(decoratePageJumps 包的 span)。事件委托(单监听管所有消息)。
    this.messagesEl.addEventListener("click", this.onMessagesClick, true);

    this.detachContext = this.actions.onContextChange((ctx) => this.renderContext(ctx));
    // #03:选区有无 → 「提炼选中要点」按钮 disabled 态;深抽进行中 → 整排 disabled。
    this.detachSelection = this.actions.onSelectionChange((has) => this.onSelectionChange(has));
    this.detachExtracting = this.actions.onExtractingChange((b) => this.onExtractingChange(b));
  }

  /** 滚动事件:据距底距离更新粘底状态。 */
  private onMessagesScroll = (): void => {
    this.stickToBottom = shouldStickToBottom(
      this.messagesEl.scrollTop,
      this.messagesEl.clientHeight,
      this.messagesEl.scrollHeight,
      STICK_THRESHOLD,
    );
  };

  /** 消息点击(事件委托):两个 affordance(#07 grill 定)——
   *   - `.shiyue-page-jump`((pN) 部分)→ 开相邻笔记的源 PDF + 跳第 N 页。
   *   - `a.internal-link`([[笔记]] 部分)→ 在预览区开该笔记(openInPreview=openInShiyue)。
   *  capture 阶段先于 Obsidian 原生 link-open;非这两类 → 放行原生(外部链接等)。
   *  sourcePath 从最近 `[data-shiyue-source]` 祖先取(每条 agent-reply 自带其触发笔记路径)。 */
  private onMessagesClick = (ev: MouseEvent): void => {
    const tgt = ev.target as HTMLElement | null;
    const pj = tgt?.closest?.(".shiyue-page-jump") as HTMLElement | null;
    if (pj) {
      ev.preventDefault(); ev.stopPropagation();
      const href = pj.dataset.href ?? "";
      const page = Number(pj.dataset.page);
      if (!href || !Number.isFinite(page)) return;
      const sourcePath = this.sourcePathOf(pj);
      const noteFile = this.app.metadataCache.getFirstLinkpathDest(href, sourcePath);
      if (noteFile) {
        void this.actions.openSourcePage(noteFile, page).catch((e) =>
          new Notice(t("panel.err.openLink", { msg: e instanceof Error ? e.message : String(e) }), 8000));
      } else {
        new Notice(t("panel.err.linkNotFound", { link: href }), 4000);
      }
      return;
    }
    const a = tgt?.closest?.("a.internal-link") as HTMLAnchorElement | null;
    const href = a?.dataset?.href;
    if (!a || !href) return;  // 非内部链接 → 让 Obsidian 原生处理
    ev.preventDefault();
    ev.stopPropagation();
    const sourcePath = this.sourcePathOf(a);
    const file = this.app.metadataCache.getFirstLinkpathDest(href, sourcePath);
    if (file) {
      void this.actions.openInPreview(file).catch((e) =>
        new Notice(t("panel.err.openLink", { msg: e instanceof Error ? e.message : String(e) }), 8000));
    } else {
      new Notice(t("panel.err.linkNotFound", { link: href }), 4000);
    }
  };

  /** 取 DOM 元素所属消息的源路径(解析其 [[笔记]] 链接用)。无则空串(顶级 resolve)。 */
  private sourcePathOf(el: HTMLElement | null): string {
    const owner = el?.closest?.("[data-shiyue-source]") as HTMLElement | null;
    return owner?.dataset?.shiyueSource ?? "";
  }

  /** 按上下文只重渲按钮排;不清消息流(消息跨上下文持久,反馈 #2)。
   *  在飞汇总:finalize(abort + streaming=false,保留已渲染部分),不丢消息。
   *  4 态门控(#03):pdf(两提取按钮,selection 无选区 disabled)/ knowledge-point(汇总按钮)/
   *  synthesis(无按钮 + 信息提示「综合笔记 — 汇总自 N 个知识点」)/ none(禁用占位)。 */
  private renderContext(ctx: PanelContext): void {
    this.finalizeStreamingSynthesis();
    this.finalizeStreamingExtraction();   // #04:切上下文 → 收尾在飞提取(abort + 终态化,保留已渲染)
    this.buttonRowEl.empty();
    this.currentButtons = [];
    this.selBtn = null;

    if (ctx.kind === "pdf") this.renderExtractionActions();
    else if (ctx.kind === "knowledge-point" && ctx.file) this.renderSynthesisActions(ctx.file);
    else if (ctx.kind === "synthesis" && ctx.file) this.renderSynthesisInfo(ctx.file);
    else this.renderDisabled();
    this.syncButtons();   // 初渲染按当前 hasSelection / extracting 定 disabled 态
  }

  // ---- pdf:两抽取按钮(点击 → runExtract* 消息生命周期:#04 user-action + streaming agent-reply)----
  private renderExtractionActions(): void {
    const batchBtn = this.buttonRowEl.createEl("button", { text: t("panel.btn.batch") });
    this.selBtn = this.buttonRowEl.createEl("button", { text: t("panel.btn.selection") });
    const onErr = (key: "panel.err.batch" | "panel.err.selection") => (e: unknown) =>
      new Notice(t(key, { msg: e instanceof Error ? e.message : String(e) }), 8000);
    batchBtn.onclick = () => { void this.runExtractBatch().catch(onErr("panel.err.batch")); };
    this.selBtn.onclick = () => { void this.runExtractSelection().catch(onErr("panel.err.selection")); };
    this.currentButtons = [batchBtn, this.selBtn];
  }

  // ---- knowledge-point:汇总按钮(存回改为汇总回复的 affordance,不在按钮排)----
  private renderSynthesisActions(file: TFile): void {
    const btn = this.buttonRowEl.createEl("button", { text: t("panel.btn.synthesis") });
    btn.onclick = () => { void this.startSynthesis(file); };
    this.currentButtons = [btn];
  }

  // ---- synthesis:无操作按钮 + 信息提示「综合笔记 — 汇总自 N 个知识点」(#03)----
  // N 读 synthesis 笔记 frontmatter synthesized_from 长度(经 PanelActions.synthesisSourceCount)。
  private renderSynthesisInfo(file: TFile): void {
    const n = this.actions.synthesisSourceCount(file);
    this.buttonRowEl.createEl("p", { cls: "shiyue-ai-hint", text: t("panel.hint.synthesis", { n }) });
  }

  private renderDisabled(): void {
    this.buttonRowEl.createEl("p", { cls: "shiyue-ai-hint", text: t("panel.hint.disabled") });
  }

  /** #03 选区变化 → 更新 hasSelection + 「提炼选中要点」按钮 disabled 态(extracting 优先整排 disabled)。 */
  private onSelectionChange(has: boolean): void {
    this.hasSelection = has;
    this.syncButtons();
  }

  /** #03 深抽进行中 → 整排 disabled 防重复触发(复用 setExtracting 同源信号)。 */
  private onExtractingChange(b: boolean): void {
    this.extracting = b;
    this.syncButtons();
  }

  /** 同步按钮 disabled 态:extracting → 全 disabled;否则「提炼选中要点」随 hasSelection,余启用。 */
  private syncButtons(): void {
    for (const btn of this.currentButtons) btn.disabled = this.extracting;
    if (!this.extracting && this.selBtn) this.selBtn.disabled = !this.hasSelection;
  }

  /** 启动汇总(含覆盖确认门,ADR-0006):点「汇总关联笔记」时 lazy 查综合笔记已存在 →
   *  确认覆盖模态 → 继续跑 runSynthesis / 取消静默。 */
  private async startSynthesis(file: TFile): Promise<void> {
    if (this.actions.synthesisNoteExists(file)) {
      const ok = await confirmOverwriteSynthesis(this.app);
      if (!ok) return;
    }
    await this.runSynthesis(file);
  }

  /** 跑汇总:单条 streaming agent-reply 增长 + 气泡内停止按钮(AbortController 贯穿,替换
   *  LoadingNotice)。取消 → synthesizeStream 静默结束,已渲染部分保留;非 abort 错 → 追加 error 消息。 */
  private async runSynthesis(file: TFile): Promise<void> {
    this.finalizeStreamingSynthesis();   // 兜底:不应有在飞(单条),防御性收尾
    const abort = new AbortController();
    const replyId = newMessageId();
    this.synthAbort = abort;
    this.synthReplyId = replyId;
    this.saveTargets.set(replyId, file);
    // 按钮点击先发 user-action(「汇总关联笔记」)——每个按钮 → user-action + agent-reply(spec §3)。
    this.appendMessage({ id: newMessageId(), kind: "user-action", label: t("panel.btn.synthesis") });
    this.appendMessage({
      id: replyId,
      kind: "agent-reply",
      markdown: t("panel.synth.working"),
      streaming: true,
      stop: () => abort.abort(),
      sourcePath: file.path,
    });
    try {
      await this.actions.synthesize(
        file,
        (md) => {
          const e = this.entries.get(replyId);
          if (e instanceof AgentReplyEntry) e.setMarkdown(md, file.path);
        },
        abort.signal,
      );
    } catch (e) {
      if (!abort.signal.aborted) {
        this.appendMessage({
          id: newMessageId(),
          kind: "error",
          message: t("panel.err.synthesis", { msg: e instanceof Error ? e.message : String(e) }),
        });
      }
    } finally {
      this.finalizeReply(replyId, abort.signal.aborted);
    }
  }

  /** 终态化一条 streaming 回复:streaming=false + 清在飞状态。aborted 时**不显 save affordance**
   *  (用户主动停止/上下文切换打断 → 不应再存回;保留已渲染部分供阅读)。正常结束且有内容 → 显 save。 */
  private finalizeReply(replyId: string, aborted: boolean): void {
    const e = this.entries.get(replyId);
    if (e instanceof AgentReplyEntry) {
      const hasContent = e.markdown.trim().length > 0;
      e.update({
        streaming: false,
        stop: undefined,
        affordance: !aborted && hasContent ? "save" : undefined,
      });
    }
    if (this.synthReplyId === replyId) {
      this.synthReplyId = null;
      this.synthAbort = null;
    }
  }

  /** 收尾在飞汇总(上下文切换 / 新汇总启动前):abort + 终态化其回复(保留部分,不显 save)。 */
  private finalizeStreamingSynthesis(): void {
    if (!this.synthAbort || !this.synthReplyId) return;
    this.synthAbort.abort();
    this.finalizeReply(this.synthReplyId, true);
  }

  // ---- 提取流式消息生命周期(#04:每个按钮 → user-action + streaming agent-reply)----

  /** 整篇提取:user-action(「提炼全书要点」)+ confirmCost 门 → 确认后 streaming agent-reply(进度
   *  「0/total」→ onProgress 更新「done/total,已抽 points 个」)→ 成功终态消息 / 取消(「已取消」)/ error。
   *  停止按钮在气泡内(AbortController 贯穿 controller)。门控由 #03 buttonRowEl disabled 保证一次一条。 */
  private async runExtractBatch(): Promise<void> {
    this.finalizeStreamingExtraction();   // 兜底:不应有在飞,防御性收尾
    const abort = new AbortController();
    const replyId = newMessageId();
    this.extractAbort = abort;
    this.extractReplyId = replyId;
    this.appendMessage({ id: newMessageId(), kind: "user-action", label: t("panel.btn.batch") });
    const handlers: ExtractionHandlers = {
      signal: abort.signal,
      onConfirmed: (total) => {   // confirmCost 通过后:append streaming reply「0/total」+ 显停止按钮
        this.appendMessage({
          id: replyId, kind: "agent-reply",
          markdown: batchProgressMarkdown(0, total, 0), streaming: true, stop: () => abort.abort(),
        });
      },
      onProgress: (done, total, points) => {   // 每块开始/结束 → 更新 reply 文本
        const e = this.entries.get(replyId);
        if (e instanceof AgentReplyEntry) e.setMarkdown(batchProgressMarkdown(done, total, points), "");
      },
    };
    let r: ExtractionResult;
    try { r = await this.actions.extractBatch(handlers); }
    catch (e) {
      this.extractAbort = null; this.extractReplyId = null;
      this.appendMessage({
        id: newMessageId(), kind: "error",
        message: t("panel.err.batch", { msg: e instanceof Error ? e.message : String(e) }),
      });
      return;
    }
    this.finalizeExtractionReply(replyId, abort.signal.aborted, r);
  }

  /** 选区提取:user-action(「提炼选中要点」)+ streaming agent-reply(进行中「精读中…」)→ 成功终态
   *  (「已提炼:<title>」)/ 取消(「已取消」)/ error。无 confirmCost 门(selection 无门)。 */
  private async runExtractSelection(): Promise<void> {
    this.finalizeStreamingExtraction();
    const abort = new AbortController();
    const replyId = newMessageId();
    this.extractAbort = abort;
    this.extractReplyId = replyId;
    this.appendMessage({ id: newMessageId(), kind: "user-action", label: t("panel.btn.selection") });
    const handlers: ExtractionHandlers = {
      signal: abort.signal,
      onBegin: () => {   // early check 通过 → append streaming reply「精读中…」
        this.appendMessage({
          id: replyId, kind: "agent-reply",
          markdown: selectionWorkingMarkdown(), streaming: true, stop: () => abort.abort(),
        });
      },
    };
    let r: ExtractionResult;
    try { r = await this.actions.extractSelection(handlers); }
    catch (e) {
      this.extractAbort = null; this.extractReplyId = null;
      this.appendMessage({
        id: newMessageId(), kind: "error",
        message: t("panel.err.selection", { msg: e instanceof Error ? e.message : String(e) }),
      });
      return;
    }
    this.finalizeExtractionReply(replyId, abort.signal.aborted, r);
  }

  /** 终态化一条提取回复:success/cancelled → 终态化 reply(文本换 result.message);fail → 终态化 reply
   *  (保留末帧,不显 save)+ 追加 error 消息。aborted(气泡内停止)→ cancelled 文本。提取无 save affordance。
   *  未 append streaming reply 时(early fail / 取消于 confirmCost 门前)→ 仅按 result 追加消息。 */
  private finalizeExtractionReply(replyId: string, aborted: boolean, r: ExtractionResult): void {
    const term = extractionTerminal(r);
    const entry = this.entries.get(replyId);
    if (entry instanceof AgentReplyEntry) {
      entry.setMarkdown(term.kind === "reply" ? term.markdown : selectionWorkingMarkdown(), "");
      entry.update({ streaming: false, stop: undefined });   // 提取无 save affordance
    } else if (term.kind === "reply") {
      // 未 append streaming reply(cancelled 于 confirmCost 门前 / 早期返):补一条终态 reply
      this.appendMessage({ id: replyId, kind: "agent-reply", markdown: term.markdown, streaming: false });
    }
    if (term.kind === "error") {
      this.appendMessage({ id: newMessageId(), kind: "error", message: term.message });
    }
    if (this.extractReplyId === replyId) {
      this.extractReplyId = null;
      this.extractAbort = null;
    }
  }

  /** 收尾在飞提取(上下文切换 / 新提取启动前 / 关面板):abort + 终态化其回复(保留末帧,显「已取消」)。 */
  private finalizeStreamingExtraction(): void {
    if (!this.extractAbort || !this.extractReplyId) return;
    this.extractAbort.abort();
    const replyId = this.extractReplyId;
    const entry = this.entries.get(replyId);
    if (entry instanceof AgentReplyEntry) {
      entry.setMarkdown(t("extract.cancelled"), "");
      entry.update({ streaming: false, stop: undefined });
    }
    this.extractAbort = null;
    this.extractReplyId = null;
  }

  /** 存为综合笔记(ADR-0006):点汇总回复的 save affordance → 追加 user-action(「存回笔记」)
   *  + agent-reply(「已存为综合笔记 [[汇总-XX]]」)消息对,调 slice 01 的 saveSynthesisAsNote。
   *  失败 → error 消息。先摘该回复的 save affordance 防重复点。触发文件按 replyId 取(绑定时记),
   *  防新汇总启动后旧回复存错文件。 */
  private async saveSynthesis(replyId: string): Promise<void> {
    const entry = this.entries.get(replyId);
    if (!(entry instanceof AgentReplyEntry)) return;
    const md = entry.markdown;
    const file = this.saveTargets.get(replyId) ?? null;
    entry.update({ affordance: undefined });
    this.appendMessage({ id: newMessageId(), kind: "user-action", label: t("panel.btn.saveSynth") });
    if (!file) return;  // 防御:无触发文件 → 不写(仅留 user-action)
    try {
      await this.actions.saveSynthesisAsNote(file, md);
      const link = `汇总 - ${file.basename}`;
      this.appendMessage({
        id: newMessageId(),
        kind: "agent-reply",
        markdown: t("panel.msg.synthSaved", { link }),
        streaming: false,
        sourcePath: file.path,
      });
    } catch (e) {
      this.appendMessage({
        id: newMessageId(),
        kind: "error",
        message: t("notice.synthSaveFail", { msg: e instanceof Error ? e.message : String(e) }),
      });
    }
  }

  // ---- 消息模型 + 渲染 ----

  /** 追加一条消息:建对应条目、挂 DOM、滚到底(若粘底)。 */
  private appendMessage(msg: ChatMessage): void {
    const entry = this.createEntry(msg);
    this.entries.set(msg.id, entry);
    this.messagesEl.appendChild(entry.el);
    this.maybeStickToBottom();
  }

  /** 据消息 kind 建条目(user-action/error 静态 DOM;agent-reply 带 Component 渲染循环)。 */
  private createEntry(msg: ChatMessage): MessageEntry {
    if (msg.kind === "user-action") {
      const el = document.createElement("div");
      el.className = "shiyue-msg shiyue-msg--user";
      if (msg.icon) el.createEl("span", { cls: "shiyue-msg-icon", text: msg.icon });
      el.createEl("span", { text: msg.label });
      return new StaticEntry(el);
    }
    if (msg.kind === "error") {
      const el = document.createElement("div");
      el.className = "shiyue-msg shiyue-msg--error";
      el.createEl("span", { text: msg.message });
      return new StaticEntry(el);
    }
    return new AgentReplyEntry(this.app, msg, () => this.maybeStickToBottom(), (replyId) => void this.saveSynthesis(replyId));
  }

  /** 若粘底,滚消息流到底(新消息 / 流式渲染后调)。 */
  private maybeStickToBottom(): void {
    if (this.stickToBottom) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  /** unload 所有消息条目(关面板兜底;消息内存清,跨会话不持久 = 预期)。 */
  private unloadAllEntries(): void {
    for (const e of this.entries.values()) e.unload();
    this.entries.clear();
    this.saveTargets.clear();
    this.synthAbort = null;
    this.synthReplyId = null;
    this.extractAbort = null;
    this.extractReplyId = null;
  }

  async onClose(): Promise<void> {
    this.finalizeStreamingSynthesis();
    this.finalizeStreamingExtraction();
    this.messagesEl.removeEventListener("scroll", this.onMessagesScroll);
    this.messagesEl.removeEventListener("click", this.onMessagesClick, true);
    this.detachContext?.();
    this.detachContext = null;
    this.detachSelection?.();
    this.detachSelection = null;
    this.detachExtracting?.();
    this.detachExtracting = null;
    this.unloadAllEntries();
  }
}

// ---- 消息条目(per-message 生命周期)----

/** 消息条目基类:持 DOM 元素 + unload 生命周期。 */
abstract class MessageEntry {
  constructor(readonly el: HTMLElement) {}
  unload(): void { /* 静态消息无 Component,无卸载 */ }
}

/** user-action / error 静态条目(无 markdown 渲染,无 Component)。 */
class StaticEntry extends MessageEntry {}

/** agent-reply 条目:MarkdownRenderer per-message Component + 去重/串行/renderGen 自废渲染循环
 *  (复用原 scheduleRender 模式,但作用于本条 contentEl 而非单 synthEl,防泄漏 D6)。
 *  streaming 期显停止按钮 + --streaming 光标;streaming=false 显 affordance:'save' 按钮(若有)。
 *  `[[笔记]](pN)` 的 (pN) 在每次渲染后包成可点 `.shiyue-page-jump` span(decoratePageJumps,方案 a)。 */
class AgentReplyEntry extends MessageEntry {
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
