export interface BatchPoint { title: string; summary: string; source_page: number; tags: string[]; related: string[]; }

export function normalizePoint(raw: any, fallbackPage: number): BatchPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return null;
  const page = Number(raw.source_page);
  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    source_page: Number.isFinite(page) ? page : fallbackPage,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: any) => typeof t === "string" && t.trim()) : [],
    related: Array.isArray(raw.related) ? raw.related.filter((r: any) => typeof r === "string" && r.trim()) : [],
  };
}
