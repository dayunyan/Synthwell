// src/workspace/ai-panel-view.ts
import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import type { PanelActions } from "./shiyue-workspace.ts";
import type { PanelContext } from "./panel-context.ts";
import { confirmOverwriteSynthesis } from "../ui/confirm-modal.ts";
import { t } from "../i18n/index.ts";
import {
  newMessageId,
  shouldStickToBottom,
  type ChatMessage,
} from "./chat-message.ts";
import { MessageEntry, StaticEntry, AgentReplyEntry } from "./agent-reply-entry.ts";
import { buttonDisabled } from "./button-gating.ts";
import {
  batchProgressMarkdown,
  selectionWorkingMarkdown,
  finalizeExtractionActions,
  type ExtractionHandlers,
  type ExtractionResult,
} from "./extraction-messages.ts";

export const SHIYUE_AI_PANEL_VIEW = "shiyue-ai-panel";

/** 自动滚动粘底阈值(px):距底 ≤ 此值视为「在底」,新内容自动滚到底。 */
const STICK_THRESHOLD = 24;

/** 在飞流式回复状态(Std #2:打包 abort + replyId,去 `synthAbort`/`synthReplyId`、
 *  `extractAbort`/`extractReplyId` Data Clump)。单 slot——一次仅一条在飞(按钮排门控整排 disabled +
 *  新流式启动前 `finalizeStreaming` 防御性收尾 + 关面板 abort 三重保证)。
 *  #09 / spec §10.1:上下文切换**不**收尾在飞回复(`renderContext` 不再调 `finalizeStreaming`)——
 *  在飞回复跨上下文切换继续完成,slot 持续到 `run*` 终态清(或 `onClose` abort)。
 *  `onAbort` 承载 abort 收尾的终态化差异(synth 保留已渲染部分不显 save;extract 显「已取消」),
 *  设于创建时,消除 kind 分支(open-closed:新流式种类自带其 onAbort,不改 finalizeStreaming)。
 *  onAbort 现仅在 `onClose`(面板销毁,防泄漏 D6)与 `run*` 启动前防御性收尾时触发。 */
type StreamingReplyState = {
  abort: AbortController;
  replyId: string;
  onAbort: (replyId: string) => void;
};

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

  // ---- 在飞流式回复状态(单条 streaming agent-reply,Std #2 打包 Data Clump)----
  /** synth/extract 共一 slot:一次仅一条在飞(按钮排门控整排 disabled + 新流式启动前
   *  finalizeStreaming 防御性收尾 + 关面板 abort 三重保证)。#09:上下文切换不收尾在飞回复——
   *  slot 持续到 run* 终态清(endStreaming,replyId-binding guard 防旧回调误清新在飞)或 onClose abort。
   *  streaming !== null 亦是 button-gating 的「整排 disabled」信号之一(跨上下文切换持续,不随 abort 清)。 */
  private streaming: StreamingReplyState | null = null;
  /** 每条汇总回复 → 其触发知识点笔记(存回用)。按 replyId 绑定,防新汇总启动后旧回复存错文件。 */
  private saveTargets = new Map<string, TFile>();

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
   *  #09 / spec §10.1:上下文切换**不**收尾在飞流式回复——在飞 agent-reply(汇总 / 提取)跨上下文切换
   *  继续完成(不 abort + 「已取消」)。abort 仅在 `onClose`(面板销毁)发生。buttonRowEl 仍按新上下文
   *  重渲(context-gating 不变),但 streaming 持续 → `syncButtons` 整排 disabled(在飞回复增长期间)。
   *  4 态门控(#03):pdf(两提取按钮,selection 无选区 disabled)/ knowledge-point(汇总按钮)/
   *  synthesis(无按钮 + 信息提示「综合笔记 — 汇总自 N 个知识点」)/ none(禁用占位)。 */
  private renderContext(ctx: PanelContext): void {
    this.buttonRowEl.empty();
    this.currentButtons = [];
    this.selBtn = null;

    if (ctx.kind === "pdf") this.renderExtractionActions();
    else if (ctx.kind === "knowledge-point" && ctx.file) this.renderSynthesisActions(ctx.file);
    else if (ctx.kind === "synthesis" && ctx.file) this.renderSynthesisInfo(ctx.file);
    else this.renderDisabled();
    this.syncButtons();   // 按当前 streaming / extracting / hasSelection 定 disabled 态(streaming 时整排灰)
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

  /** 同步按钮 disabled 态(#09:经 button-gating 纯决策)。streaming(在飞流式,跨上下文切换持续)OR
   *  extracting(深抽进行中)→ 整排 disabled;否则 selection 按钮随 hasSelection,余启用。
   *  streaming 维度是 #09 新增——汇总/batch 流式期间整排灰(原仅 selection 经 extracting 禁用)。 */
  private syncButtons(): void {
    const s = { streaming: this.streaming !== null, extracting: this.extracting, hasSelection: this.hasSelection };
    for (const btn of this.currentButtons) {
      btn.disabled = buttonDisabled(s, btn === this.selBtn);
    }
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
    this.finalizeStreaming();   // 兜底:不应有在飞(单条),防御性收尾
    const abort = new AbortController();
    const replyId = newMessageId();
    this.beginStreaming({
      abort, replyId,
      onAbort: (id) => this.finalizeReply(id, true),   // 保留已渲染部分,不显 save(aborted=true)
    });
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
      this.endStreaming(replyId);   // 终态清 slot + 重渲按钮排恢复 enabled(#09:跨上下文切换持续到此)
    }
  }

  /** 终态化一条 streaming 回复的**条目**(streaming=false + stop 摘除 + affordance 决策):纯 entry 更新,
   *  不清 streaming slot(由 finalizeStreaming / run* 终态清,防旧回调误清新在飞)。aborted 时**不显 save
   *  affordance**(用户主动停止/上下文切换打断 → 不应再存回;保留已渲染部分供阅读)。正常结束且有内容 → 显 save。 */
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
  }

  /** 收尾在飞流式回复(abort + 调 onAbort 终态化其 reply + 清 slot)。**#09:仅在 `onClose`(面板销毁,
   *  防 Component 泄漏 D6)与 `run*` 启动前防御性收尾时调——上下文切换不再调**(在飞回复跨切换继续完成)。
   *  Std #2:去重原 finalizeStreamingSynthesis/finalizeStreamingExtraction 的守卫 + abort + 清状态重复。
   *  终态化差异由 state.onAbort 承载(synth 保留已渲染部分,不显 save;extract 显「已取消」),无需 kind 分支。
   *  不重渲按钮排(关面板时 row 将销毁;run* 启动后立即 beginStreaming 会重渲)。 */
  private finalizeStreaming(): void {
    if (!this.streaming) return;
    const { abort, replyId, onAbort } = this.streaming;
    abort.abort();
    onAbort(replyId);
    this.streaming = null;
  }

  /** 开始一条流式回复:设 slot + 重渲按钮排整排 disabled(#09:streaming 维度驱动整排灰,跨上下文切换持续)。
   *  run* 创建 streaming 后调此(替直接赋值),确保按钮排即时灰。 */
  private beginStreaming(s: StreamingReplyState): void {
    this.streaming = s;
    this.syncButtons();
  }

  /** 终态清在飞 slot(仅当仍是本回复——replyId-binding guard 防旧回调误清新在飞)+ 重渲按钮排恢复 enabled。
   *  run* 终态(完成/取消/error)调此(替直接清 slot),确保回复完成后整排按新上下文 + selection 态恢复。 */
  private endStreaming(replyId: string): void {
    if (this.streaming?.replyId === replyId) this.streaming = null;
    this.syncButtons();
  }

  // ---- 提取流式消息生命周期(#04:每个按钮 → user-action + streaming agent-reply)----

  /** 整篇提取:confirmCost 门 → 确认后 user-action(「提炼全书要点」)+ streaming agent-reply(进度
   *  「0/total」→ onProgress 更新「done/total,已抽 points 个」)→ 成功终态消息 / 取消(「已取消」)/ error。
   *  #调整:confirmCost 模态先于 user-action 显(门是预操作:点按钮先弹预估花费,确认后才显 user-action
   *  气泡;撤回则无 user-action,静默)。停止按钮在气泡内(AbortController 贯穿 controller)。
   *  门控由 #03 buttonRowEl disabled 保证一次一条。 */
  private runExtractBatch(): Promise<void> {
    return this.runExtract({
      label: t("panel.btn.batch"),
      errKey: "panel.err.batch",
      buildHandlers: (replyId, abort, appendUserAction) => ({
        signal: abort.signal,
        onConfirmed: (total) => {   // confirmCost 通过后:先显 user-action,再 append streaming reply「0/total」
          appendUserAction();
          this.appendMessage({
            id: replyId, kind: "agent-reply",
            markdown: batchProgressMarkdown(0, total, 0), streaming: true, stop: () => abort.abort(),
          });
        },
        onProgress: (done, total, points) => {   // 每块开始/结束 → 更新 reply 文本
          const e = this.entries.get(replyId);
          if (e instanceof AgentReplyEntry) e.setMarkdown(batchProgressMarkdown(done, total, points), "");
        },
      }),
      run: (handlers) => this.actions.extractBatch(handlers),
    });
  }

  /** 选区提取:user-action(「提炼选中要点」)+ streaming agent-reply(进行中「精读中…」)→ 成功终态
   *  (「已提炼:<title>」)/ 取消(「已取消」)/ error。无 confirmCost 门 → user-action 点按钮即显。 */
  private runExtractSelection(): Promise<void> {
    return this.runExtract({
      label: t("panel.btn.selection"),
      errKey: "panel.err.selection",
      buildHandlers: (replyId, abort, appendUserAction) => {
        appendUserAction();   // selection 无门:点按钮即显 user-action(与 batch 的门后显对称)
        return {
          signal: abort.signal,
          onBegin: () => {   // early check 通过 → append streaming reply「精读中…」
            this.appendMessage({
              id: replyId, kind: "agent-reply",
              markdown: selectionWorkingMarkdown(), streaming: true, stop: () => abort.abort(),
            });
          },
        };
      },
      run: (handlers) => this.actions.extractSelection(handlers),
    });
  }

  /** 提取消息生命周期骨架(batch/selection 共用):收尾在飞 → 新 AbortController + replyId →
   *  buildHandlers(决定 user-action 何时显)+ run(catch 另 error 消息)→ finalizeExtractionReply 终态化。
   *  user-action 时序由 buildHandlers 经 appendUserAction 回调自定:selection 即显;batch 门后显。
   *  run 调对应 workspace 动作。 */
  private async runExtract(opts: {
    label: string;
    errKey: "panel.err.batch" | "panel.err.selection";
    buildHandlers: (replyId: string, abort: AbortController, appendUserAction: () => void) => ExtractionHandlers;
    run: (handlers: ExtractionHandlers) => Promise<ExtractionResult>;
  }): Promise<void> {
    this.finalizeStreaming();   // 兜底:不应有在飞,防御性收尾
    const abort = new AbortController();
    const replyId = newMessageId();
    this.beginStreaming({
      abort, replyId,
      onAbort: (id) => {   // 显「已取消」(进度帧无保留价值)
        const entry = this.entries.get(id);
        if (entry instanceof AgentReplyEntry) {
          entry.setMarkdown(t("extract.cancelled"), "");
          entry.update({ streaming: false, stop: undefined });
        }
      },
    });
    const appendUserAction = (): void =>
      this.appendMessage({ id: newMessageId(), kind: "user-action", label: opts.label });
    const handlers = opts.buildHandlers(replyId, abort, appendUserAction);
    let r: ExtractionResult;
    try { r = await opts.run(handlers); }
    catch (e) {
      this.endStreaming(replyId);
      this.appendMessage({
        id: newMessageId(), kind: "error",
        message: t(opts.errKey, { msg: e instanceof Error ? e.message : String(e) }),
      });
      return;
    }
    this.finalizeExtractionReply(replyId, r);
    this.endStreaming(replyId);
  }

  /** 终态化一条提取回复的**条目**:据「是否已有 streaming reply」+ result 算终态动作(判别联合
   *  finalizeExtractionActions),面板执行 DOM。纯 entry 更新,不清 streaming slot(由 runExtract 终态清,
   *  防旧回调误清新在飞)。提取无 save affordance(终态化后 stop 摘除,不显 save)。 */
  private finalizeExtractionReply(replyId: string, r: ExtractionResult): void {
    const entry = this.entries.get(replyId);
    const actions = finalizeExtractionActions(entry instanceof AgentReplyEntry, r);
    switch (actions.kind) {
      case "finalize-reply":
        this.finalizeExistingReply(entry, actions.markdown);
        break;
      case "finalize-reply-and-error":
        this.finalizeExistingReply(entry, actions.markdown);   // fail 保留末帧进行中文本
        this.appendMessage({ id: newMessageId(), kind: "error", message: actions.error });
        break;
      case "append-error":
        this.appendMessage({ id: newMessageId(), kind: "error", message: actions.error });
        break;
      case "silent":
        break;
    }
  }

  /** 终态化已有 streaming reply:换 markdown(fail 保留末帧)+ 摘 stop。非 AgentReplyEntry 时静默
   *  (finalizeExtractionActions 据 hasStreamingReply 决策,hasStreamingReply=false 不会落到此)。 */
  private finalizeExistingReply(entry: MessageEntry | undefined, markdown: string): void {
    if (entry instanceof AgentReplyEntry) {
      entry.setMarkdown(markdown, "");
      entry.update({ streaming: false, stop: undefined });
    }
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
    this.streaming = null;
  }

  async onClose(): Promise<void> {
    this.finalizeStreaming();
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
