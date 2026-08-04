// src/workspace/synthesis-controller.ts
import { App, TFile } from "obsidian";
import { ensureFolder, dirOf } from "../core/fs/vault-fs.ts";
import { buildProvider } from "./llm-provider.ts";
import { Synthesizer, filterAssociated } from "../core/extraction/synthesizer.ts";
import { parseKnowledgeNote } from "../core/extraction/note-parser.ts";
import { buildSynthesisNoteContent, resolveSynthesisPath } from "../core/extraction/synthesis-note.ts";
import { t } from "../i18n/index.ts";
import type { KnowledgeNote } from "../core/extraction/synthesizer.ts";
import type { ShiyueSettings } from "../settings.ts";

/** 汇总胶水(与 ExtractionController 同层):组 SynthesisInput(当前知识点 + 扫关联笔记)→ Synthesizer.synthesizeStream。
 *  无 UI、无 LoadingNotice(面板拥有 AbortController + 渲染;controller 只组数据 + 流)。
 *  - current:读当前知识点笔记(basename + 内容)→ parseKnowledgeNote。
 *  - candidates:扫 notesPath 下所有 .md,parseKnowledgeNote 各自(含已删/历史的同名也不怕——filterAssociated 按标题去重排自身)。
 *  - associated:filterAssociated(current, candidates)(tag/backlink 关联,强关联优先,≤20)。
 *  流式:onChunk(markdown, sparse) 逐帧回调;signal abort → synthesizeStream 停止不抛(面板保留已渲染部分)。
 *
 *  综合笔记存为图谱节点(ADR-0006):synthesize 时缓存源 KP 列表(完整 KnowledgeNote 形,含 tags),
 *  saveSynthesisAsNote 复用(不重读 vault);重汇总 = 覆写同路径文件,bump frontmatter。 */
export class SynthesisController {
  /** 上一次 synthesize 的源 KP 列表(current + matched candidates,完整 KnowledgeNote 形)。
   *  saveSynthesisAsNote 复用此缓存组综合笔记(synthesized_from 双链 + tags 并集),不重读 vault。
   *  与 lastTriggerPath 配对验同一触发文件(缓存命中);否则 re-derive 防陈旧。 */
  private lastSources: KnowledgeNote[] | null = null;
  private lastTriggerPath: string | null = null;

  constructor(private app: App, private settings: () => ShiyueSettings) {}

  /** 流式汇总。onChunk 在每帧累积 markdown 时调;signal 取消则静默结束(不抛)。非 abort 错抛出。 */
  async synthesize(
    file: TFile,
    onChunk: (markdown: string, sparse: boolean) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const s = this.settings();
    const provider = buildProvider(this.app, s);
    if (!provider) { throw new Error(t("notice.noApiKey")); }
    const synth = new Synthesizer(provider);

    const current = parseKnowledgeNote(file.basename, await this.app.vault.read(file));
    const candidates = await this.loadCandidates(s.notesPath);
    const associated = filterAssociated(current, candidates);

    // 缓存源 KP(完整 KnowledgeNote,含 tags)供 saveSynthesisAsNote 复用(不重读)。
    this.lastTriggerPath = file.path;
    this.lastSources = this.sourcesFrom(current, candidates, associated);

    for await (const chunk of synth.synthesizeStream({ current, associated }, signal)) {
      onChunk(chunk.markdown, chunk.sparse);
    }
  }

  /** 扫 notesPath 下所有 .md 笔记 → KnowledgeNote[]。容错:单条解析失败跳过(不炸整批)。 */
  private async loadCandidates(notesPath: string): Promise<KnowledgeNote[]> {
    const files = this.app.vault.getFiles().filter(f => f.extension === "md" && f.path.startsWith(notesPath));
    const out: KnowledgeNote[] = [];
    for (const f of files) {
      try { out.push(parseKnowledgeNote(f.basename, await this.app.vault.read(f))); }
      catch { /* 跳过无法解析的笔记 */ }
    }
    return out;
  }

  /** 源 KP 列表 = current + 命中关联的候选(完整 KnowledgeNote,保留 tags 供综合笔记 tags 并集)。
   *  关联匹配按 title(与 filterAssociated 的 sameTitle 同语义:trim+lower);current 在前,关联按 associated 序。 */
  private sourcesFrom(current: KnowledgeNote, candidates: KnowledgeNote[], associated: { title: string }[]): KnowledgeNote[] {
    const assocTitles = new Set(associated.map(a => a.title.trim().toLowerCase()));
    const matched = candidates.filter(c => assocTitles.has(c.title.trim().toLowerCase()));
    return [current, ...matched];
  }

  /** 取源 KP 列表(缓存命中则复用,否则 re-derive)。re-derive 仅在缓存缺失/陈旧时跑(面板正常流程
   *  save 紧跟 synthesize 同一文件,缓存命中;防御性 re-derive 保正确性)。 */
  private async resolveSources(trigger: TFile): Promise<{ sources: KnowledgeNote[]; triggerTitle: string }> {
    if (this.lastSources && this.lastTriggerPath === trigger.path) {
      return { sources: this.lastSources, triggerTitle: this.lastSources[0]?.title ?? trigger.basename };
    }
    const s = this.settings();
    const current = parseKnowledgeNote(trigger.basename, await this.app.vault.read(trigger));
    const candidates = await this.loadCandidates(s.notesPath);
    const associated = filterAssociated(current, candidates);
    const sources = this.sourcesFrom(current, candidates, associated);
    this.lastTriggerPath = trigger.path;
    this.lastSources = sources;
    return { sources, triggerTitle: current.title };
  }

  /** 存为综合笔记(ADR-0006):组源 KP 列表(复用 synthesize 时缓存的 associated,不重读)→
   *  buildSynthesisNoteContent(纯 seam)→ 原子写(存在 → vault.process 覆写 body+frontmatter;
   *  新建 → ensureFolder + vault.create)。文件名稳定(汇总 - <basename>.md)→ 重汇总覆盖同路径、bump frontmatter。
   *  空 synthesis 亦可存。非 abort 错抛出交面板提示。 */
  async saveSynthesisAsNote(trigger: TFile, synthesis: string): Promise<void> {
    const s = this.settings();
    const { sources, triggerTitle } = await this.resolveSources(trigger);
    const content = buildSynthesisNoteContent({
      triggerTitle,
      sources,
      synthesisMd: synthesis,
      model: s.model,
      synthesizedAt: new Date().toISOString().slice(0, 10),
    });
    const path = resolveSynthesisPath(trigger.basename, s.synthesisPath);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      // 存在 → 原子读-改-写(此处全替换:seam 产完整内容,忽略旧 data 返新)。vault.process 串行化防并发写丢数据(spec D4)。
      await this.app.vault.process(existing, () => content);
    } else {
      await ensureFolder(this.app.vault.adapter, dirOf(path));
      await this.app.vault.create(path, content);
    }
  }

  /** 综合笔记是否已存在(点「汇总关联笔记」时 lazy 查,确认覆盖用)。getAbstractFileByPath 纯内存查(无 IO)。 */
  synthesisNoteExists(trigger: TFile): boolean {
    const s = this.settings();
    const path = resolveSynthesisPath(trigger.basename, s.synthesisPath);
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }
}
