// E4 (task 7): text-anchored highlight logic — Annotator/Hypothesis style.
// CJK has no word boundaries and v4 pdfjs lacks the #20334 word-spacing fix,
// so character offsets within a page drift relative to glyph coordinates.
// Anchoring to the surrounding *text* (prefix/exact/postfix) sidesteps that
// for highlight *persistence*: we store text, not coordinates, and re-locate
// the range against the page's full text on re-render. This module is pure
// (no DOM, no pdfjs) so it unit-tests cleanly under `node --test`.

export interface Anchor {
  prefix: string;
  exact: string;
  postfix: string;
  page: number;
}

/** Build a text anchor from a selection: capture ±window chars around the
 *  selected text within the page's full text. Throws if the selection isn't
 *  found in pageText (caller should fall back to exact-only). */
export function buildAnchor(
  selected: string,
  pageText: string,
  page: number,
  window = 30,
): Anchor {
  const idx = pageText.indexOf(selected);
  if (idx < 0) throw new Error("selected text not found in page text");
  const start = Math.max(0, idx - window);
  const end = Math.min(pageText.length, idx + selected.length + window);
  return {
    prefix: pageText.slice(start, idx),
    exact: selected,
    postfix: pageText.slice(idx + selected.length, end),
    page,
  };
}

/** Re-locate a selection's [start,end) offsets in page text using the anchor.
 *  Tries the full (prefix+exact+postfix) probe first; falls back to exact-only. */
export function resolveAnchor(
  a: Anchor,
  pageText: string,
): { start: number; end: number } | null {
  const probe = a.prefix + a.exact + a.postfix;
  const at = pageText.indexOf(probe);
  if (at >= 0) {
    return { start: at + a.prefix.length, end: at + a.prefix.length + a.exact.length };
  }
  const e = pageText.indexOf(a.exact);
  return e >= 0 ? { start: e, end: e + a.exact.length } : null;
}

/** Build a page's full text from pdfjs TextContent items (joined by '' for CJK,
 *  since CJK has no spaces — matching how the selection string will look). */
export function pageTextFromItems(items: { str: string }[]): string {
  return items.map((i) => i.str).join("");
}
