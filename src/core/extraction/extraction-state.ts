import { ensureFolder, dirOf } from "../fs/vault-fs.ts";

export interface ExtractedRecord { hash: string; point_titles: string[]; model: string; extracted_at: string; }

/** Per-PDF 抽取状态,持久化到 .shiyue/extraction-state.json。避免重复抽取 + 增量。 */
export class ExtractionState {
  private adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void> };
  private path: string;
  constructor(adapter: { exists(p: string): Promise<boolean>; read(p: string): Promise<string>; write(p: string, data: string): Promise<void> }, path = ".shiyue/extraction-state.json") {
    this.adapter = adapter; this.path = path;
  }
  private async loadAll(): Promise<Record<string, ExtractedRecord>> {
    if (!await this.adapter.exists(this.path)) return {};
    try { return JSON.parse(await this.adapter.read(this.path)); } catch { return {}; }  // 损坏的状态文件 → 当作无记录,重新抽取
  }
  async get(pdfName: string): Promise<ExtractedRecord | null> {
    const all = await this.loadAll();
    return all[pdfName] ?? null;
  }
  async record(pdfName: string, hash: string, point_titles: string[], model: string): Promise<void> {
    const all = await this.loadAll();
    all[pdfName] = { hash, point_titles, model, extracted_at: new Date().toISOString().slice(0, 10) };
    await ensureFolder(this.adapter, dirOf(this.path));  // 首次写 .shiyue/ 不存在 → ENOENT,先建
    await this.adapter.write(this.path, JSON.stringify(all, null, 2));
  }
}
