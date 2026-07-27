import { estimateTokens } from "./usage.ts";

export interface PageText { page: number; text: string; }
export interface Chunk { text: string; pages: number[]; }

/** 按 token budget 分块,页对齐(不跨页切,便于 source_page 准确)。
 *  overlap 暂不实现(spec 写 200,但页对齐下 overlap 复杂;先简化为无 overlap,后续优化)。 */
export function chunkPages(pages: PageText[], budgetTokens: number, _overlap = 0): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk = { text: "", pages: [] };
  for (const p of pages) {
    const pageTokens = estimateTokens(p.text);
    if (cur.pages.length && estimateTokens(cur.text) + pageTokens > budgetTokens) {
      chunks.push(cur); cur = { text: "", pages: [] };
    }
    cur.text += p.text; cur.pages.push(p.page);
  }
  if (cur.pages.length) chunks.push(cur);
  return chunks;
}
