/** Robustly parse JSON from LLM output: strip code fences, then fall back to
 *  extracting the first [...] / {...} span. Returns null if unparseable (no throw). */
export function parseLLMJson<T>(raw: string): T | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  const start = s.search(/[[{]/);
  const end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)) as T; } catch { return null; }
  }
  return null;
}
