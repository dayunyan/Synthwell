// src/workspace/synthesis-controller.ts
import { App, TFile } from "obsidian";
import { buildProvider } from "./llm-provider.ts";
import { Synthesizer, filterAssociated } from "../core/extraction/synthesizer.ts";
import { parseKnowledgeNote } from "../core/extraction/note-parser.ts";
import { appendSynthesisSection } from "../core/extraction/synth-section.ts";
import { t } from "../i18n/index.ts";
import type { KnowledgeNote } from "../core/extraction/synthesizer.ts";
import type { ShiyueSettings } from "../settings.ts";

/** 汇总胶水(与 ExtractionController 同层):组 SynthesisInput(当前知识点 + 扫关联笔记)→ Synthesizer.synthesizeStream。
 *  无 UI、无 LoadingNotice(面板拥有 AbortController + 渲染;controller 只组数据 + 流)。
 *  - current:读当前知识点笔记(basename + 内容)→ parseKnowledgeNote。
 *  - candidates:扫 notesPath 下所有 .md,parseKnowledgeNote 各自(含已删/历史的同名也不怕——filterAssociated 按标题去重排自身)。
 *  - associated:filterAssociated(current, candidates)(tag/backlink 关联,强关联优先,≤20)。
 *  流式:onChunk(markdown, sparse) 逐帧回调;signal abort → synthesizeStream 停止不抛(面板保留已渲染部分)。 */
export class SynthesisController {
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

  /** 存回笔记(spec §6「保存(可选)」):把综合摘要追加到当前知识点笔记的 `## 综合汇总` 章节。
   *  用 vault.process 原子读-改-写(spec D4 串行写,防 file.saving 永真丢数据):fn 收最新内容
   *  → appendSynthesisSection(纯 seam)→ 写回。空 synthesis 亦可存。非 abort 错抛出交面板提示。 */
  async saveToNote(file: TFile, synthesis: string): Promise<void> {
    await this.app.vault.process(file, (data) => appendSynthesisSection(data, synthesis));
  }
}
