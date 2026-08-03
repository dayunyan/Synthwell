// src/workspace/ai-panel-view.ts
import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, Component } from "obsidian";
import type { PanelActions } from "./shiyue-workspace.ts";
import type { PanelContext } from "./panel-context.ts";
import { LoadingNotice } from "../ui/loading-notice.ts";
import { t } from "../i18n/index.ts";

export const SHIYUE_AI_PANEL_VIEW = "shiyue-ai-panel";

/** 拾阅 AI 面板:按上下文切换两态(#05 wiring)。
 *  - pdf → 两抽取按钮(整篇 / 选区)。
 *  - knowledge-point → 「汇总这个知识点」按钮 + 流式渲染综合摘要([[笔记]](pN) 可点跳转,原生)。
 *  - none → 禁用占位。
 *  渲染用 MarkdownRenderer.render + 每帧 Component 生命周期(替换/取消 unload 旧 Component,防泄漏 spec D6)。
 *  取消用 AbortController 贯穿(LoadingNotice 的「停止」→ abort;与抽取一致)。 */
export class AiPanelView extends ItemView {
  private actions: PanelActions;
  private actionsEl!: HTMLElement;
  private synthesisEl!: HTMLElement;
  private detachContext: (() => void) | null = null;

  // 合成渲染状态
  private synthAbort: AbortController | null = null;
  private synthComp: Component | null = null;
  private renderChain: Promise<void> = Promise.resolve();
  private renderGen = 0;          // 每次 teardown 递增;in-flight 渲染据此自废
  private synthActive = false;    // 是否有渲染在跑(去重)
  private latestMd = "";
  private latestPath = "";
  private synthSourcePath = "";   // 当前汇总的源笔记路径(解析其 [[笔记]] 链接用)
  private synthFile: TFile | null = null;       // 当前汇总的知识点笔记(存回笔记用)
  private synthSaveBtn: HTMLButtonElement | null = null;  // 「存回笔记」按钮(汇总有内容后显)

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

    this.actionsEl = c.createDiv({ cls: "shiyue-ai-actions" });
    this.synthesisEl = c.createDiv({ cls: "shiyue-ai-synthesis" });
    c.createDiv({ cls: "shiyue-ai-chat-placeholder" })
      .createEl("p", { text: t("panel.chatPlaceholder") });

    // 视图关闭时 unload 当前渲染 Component(防泄漏,spec D6)。
    // 不把每帧 Component addChild 到视图(会累积死 child);改为手动 unload + 这里注册一次兜底。
    this.register(() => this.unloadSynthComp());
    this.detachContext = this.actions.onContextChange((ctx) => this.renderContext(ctx));
    // capture 阶段先于 Obsidian 原生 link-open:汇总输出里的 [[笔记]] 链接点 → 在上方预览区打开(Bug 3),
    // 而非 native openLinkText 开到别处。data-href 是内部链接的 linkpath。
    this.synthesisEl.addEventListener("click", this.onSynthesisClick, true);
  }

  /** 汇总输出点击:两个 affordance(#07 grill 定)——
   *   - `.shiyue-page-jump`((pN) 部分)→ 开相邻笔记的源 PDF + 跳第 N 页(decoratePageJumps 包的 span)。
   *   - `a.internal-link`([[笔记]] 部分)→ 在预览区开该笔记(不变,复用 openInPreview=openInShiyue)。
   *  capture 阶段先于 Obsidian 原生 link-open;非这两类 → 放行原生(外部链接等)。 */
  private onSynthesisClick = (ev: MouseEvent): void => {
    const tgt = ev.target as HTMLElement | null;
    const pj = tgt?.closest?.(".shiyue-page-jump") as HTMLElement | null;
    if (pj) {
      ev.preventDefault(); ev.stopPropagation();
      const href = pj.dataset.href ?? "";
      const page = Number(pj.dataset.page);
      if (!href || !Number.isFinite(page)) return;
      const noteFile = this.app.metadataCache.getFirstLinkpathDest(href, this.synthSourcePath);
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
    if (!a || !href) return;  // 非内部链接 → 让 Obsidian 原生处理(外部链接等)
    ev.preventDefault();
    ev.stopPropagation();
    const file = this.app.metadataCache.getFirstLinkpathDest(href, this.synthSourcePath);
    if (file) {
      void this.actions.openInPreview(file).catch((e) =>
        new Notice(t("panel.err.openLink", { msg: e instanceof Error ? e.message : String(e) }), 8000));
    } else {
      new Notice(t("panel.err.linkNotFound", { link: href }), 4000);
    }
  };

  /** MarkdownRenderer 渲完后,把 `[[笔记]](pN)` 里的 `(pN)` 文本节点包成独立可点 `.shiyue-page-jump` span
   *  (#07 两个 affordance 的 fiddly 部分,选方案 (a) post-process DOM)。
   *  - `[[笔记]]` → Obsidian 渲成 `a.internal-link`;紧随其后的 Text 节点若以 `(pN)` 开头(允许前置空白),
   *    把 `(pN)` 段包成 span(data-href 取相邻链接、data-page 取页码),其余文本留在原 Text 节点。
   *  - 不改 synthesizer 输出格式 → LLM prompt/质量不动(synthesizer.test.ts 不回归);脆性限于本 DOM 胶水(人工验)。 */
  private decoratePageJumps(): void {
    const links = Array.from(this.synthesisEl.querySelectorAll<HTMLAnchorElement>("a.internal-link"));
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

  /** 按上下文切换按钮区;切换即取消在飞汇总 + 清空渲染(防残留 + 防泄漏)。 */
  private renderContext(ctx: PanelContext): void {
    this.teardownSynthesis();
    this.actionsEl.empty();
    this.synthSaveBtn = null;  // actionsEl 已清空,旧按钮 DOM 脱离;置空防悬空引用
    this.synthesisEl.empty();
    this.synthesisEl.toggleClass("is-active", false);

    if (ctx.kind === "pdf") this.renderExtractionActions();
    else if (ctx.kind === "knowledge-point" && ctx.file) this.renderSynthesisActions(ctx.file);
    else this.renderDisabled();
  }

  // ---- pdf:两抽取按钮(现状)----
  private renderExtractionActions(): void {
    const batchBtn = this.actionsEl.createEl("button", { text: t("panel.btn.batch") });
    const selBtn = this.actionsEl.createEl("button", { text: t("panel.btn.selection") });
    const onErr = (key: "panel.err.batch" | "panel.err.selection") => (e: unknown) =>
      new Notice(t(key, { msg: e instanceof Error ? e.message : String(e) }), 8000);
    batchBtn.onclick = () => { void this.actions.extractBatch().catch(onErr("panel.err.batch")); };
    selBtn.onclick = () => { void this.actions.extractSelection().catch(onErr("panel.err.selection")); };
  }

  // ---- knowledge-point:汇总按钮 + 存回笔记按钮(汇总有内容后显)----
  private renderSynthesisActions(file: TFile): void {
    const btn = this.actionsEl.createEl("button", { text: t("panel.btn.synthesis") });
    btn.onclick = () => { void this.runSynthesis(file); };
    const saveBtn = this.actionsEl.createEl("button", { text: t("panel.btn.saveSynth"), cls: "shiyue-ai-synth-save" });
    saveBtn.hidden = true;  // 汇总渲染出内容后才显(runSynthesis 结束时按 latestMd 决定)
    saveBtn.onclick = () => {
      if (this.synthFile && this.latestMd) void this.saveSynthesis(this.synthFile, this.latestMd);
    };
    this.synthSaveBtn = saveBtn;
  }

  private renderDisabled(): void {
    this.actionsEl.createEl("p", { cls: "shiyue-ai-hint", text: t("panel.hint.disabled") });
  }

  /** 跑汇总:AbortController 贯穿 + LoadingNotice(停止→abort,与抽取一致)+ 流式渲染到 synthesisEl。
   *  取消 → synthesizeStream 静默结束,已渲染部分保留;非 abort 错 → Notice。 */
  private async runSynthesis(file: TFile): Promise<void> {
    this.teardownSynthesis();
    this.synthSourcePath = file.path;   // 解析本笔记汇总输出里的 [[笔记]] 链接用
    this.synthFile = file;              // 存回笔记的目标笔记
    const abort = new AbortController();
    this.synthAbort = abort;
    const loading = new LoadingNotice(this.app, t("panel.synth.loading"), () => abort.abort());
    loading.show();
    this.synthesisEl.empty();
    this.synthesisEl.toggleClass("is-active", true);
    this.synthesisEl.createDiv({ cls: "shiyue-ai-synthesizing", text: t("panel.synth.working") });
    try {
      await this.actions.synthesize(
        file,
        (md, sparse) => this.scheduleRender(md, sparse, file.path),
        abort.signal,
      );
    } catch (e) {
      if (!abort.signal.aborted) {
        new Notice(t("panel.err.synthesis", { msg: e instanceof Error ? e.message : String(e) }), 8000);
      }
    } finally {
      loading.hide();
      this.synthAbort = null;
      // 有内容(含失败保留的部分)→ 显「存回笔记」;空(全取消/未出帧)→ 藏
      if (this.synthSaveBtn) this.synthSaveBtn.hidden = !this.latestMd;
    }
  }

  /** 存回笔记:把当前综合摘要追加到知识点笔记的 `## 综合汇总` 章节(spec §6)。
   *  成功/失败 Notice(i18n);存写中 disable 按钮防重复点。 */
  private async saveSynthesis(file: TFile, md: string): Promise<void> {
    if (this.synthSaveBtn) this.synthSaveBtn.disabled = true;
    try {
      await this.actions.saveSynthesisToNote(file, md);
      new Notice(t("notice.synthSaved"), 4000);
    } catch (e) {
      new Notice(t("notice.synthSaveFail", { msg: e instanceof Error ? e.message : String(e) }), 8000);
    } finally {
      if (this.synthSaveBtn) this.synthSaveBtn.disabled = false;
    }
  }

  /** 流式渲染调度:去重 + 串行化。rapid 帧合并——只渲最新 markdown,旧 Component unload 防泄漏。
   *  renderGen 让 teardown 后的 in-flight 渲染自废(不再 empty/append)。
   *  每帧 Component 手动 load/unload(不 addChild 到视图,避免累积死 child);视图关闭由 onOpen 注册的兜底 unload)。 */
  private scheduleRender(md: string, sparse: boolean, path: string): void {
    void sparse;  // sparse 仅首帧有意义(controller 据此决定;面板统一渲染,不区分)
    this.latestMd = md; this.latestPath = path;
    if (this.synthActive) return;  // 已有渲染在跑,链尾会取最新值
    this.synthActive = true;
    const gen = this.renderGen;
    this.renderChain = this.renderChain.then(async () => {
      try {
        while (gen === this.renderGen) {
          const m = this.latestMd, p = this.latestPath;
          this.unloadSynthComp();
          const comp = new Component();
          this.synthComp = comp;
          this.synthesisEl.empty();
          await MarkdownRenderer.render(this.app, m, this.synthesisEl, p, comp);
          comp.load();  // 激活 Component(注册的 DOM/event 回调在此挂载)
          this.decoratePageJumps();  // [[笔记]](pN) 的 (pN) 包成可点 span(#07,方案 a post-process DOM)
          if (gen !== this.renderGen) break;     // 已被 teardown
          if (this.latestMd === m) break;         // 无更新的帧 → 结束
        }
      } catch {
        // MarkdownRenderer.render 不应抛;吞掉保活 renderChain
      } finally {
        if (gen === this.renderGen) this.synthActive = false;
      }
    });
  }

  /** unload 当前渲染 Component(防泄漏)。 */
  private unloadSynthComp(): void {
    this.synthComp?.unload();
    this.synthComp = null;
  }

  /** 取消在飞汇总 + unload 当前渲染 Component + 让 in-flight 渲染自废。 */
  private teardownSynthesis(): void {
    this.renderGen++;
    this.synthAbort?.abort();
    this.synthAbort = null;
    this.unloadSynthComp();
    this.synthActive = false;
    this.latestMd = "";
    this.synthFile = null;
    if (this.synthSaveBtn) this.synthSaveBtn.hidden = true;
  }

  async onClose(): Promise<void> {
    this.teardownSynthesis();
    this.synthesisEl.removeEventListener("click", this.onSynthesisClick, true);
    this.detachContext?.();
    this.detachContext = null;
  }
}
