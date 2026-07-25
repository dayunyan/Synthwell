// Scope pdfjs pdf_viewer.css under .shiyue-pdf-root so it doesn't clash with
// Obsidian's own native-PDF-viewer styles (which use the same .pdfViewer/.page/
// .textLayer/.canvasWrapper class names). Obsidian loads a single styles.css,
// so we fold the scoped rules into it.
//
// This is a lightweight CSS tokenizer, not a full parser — but pdf_viewer.css
// is machine-generated with a flat { ... } / @block { ... } structure, so it's
// sufficient. The one subtlety that bit an earlier version: selector comma
// lists can contain commas INSIDE functional pseudo-classes (:is/:not/:has/
// :where argument lists). Splitting on every comma produced broken selectors
// like `.textLayer :is(span, .shiyue-pdf-root br)`. The splitter here is
// paren-depth-aware: it only splits a selector list on commas at paren depth 0.
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = ".shiyue-pdf-root";
const SRC = "node_modules/pdfjs-dist/web/pdf_viewer.css";
const DST = "styles.css";

const src = readFileSync(SRC, "utf8");
const scoped = scopeSheet(src);

const banner = `/* === BEGIN pdfjs pdf_viewer.css (v5.4.530) — auto-scoped under
     ${ROOT} by scripts/scope-pdfjs-css.mjs. Do NOT hand-edit; regenerate via
     \`node scripts/scope-pdfjs-css.mjs\`. Original: ${SRC}. Needed because
     PDFViewer's .page/.canvasWrapper/.textLayer/.endOfContent rules are what
     make rendering + selection bounding work, and Obsidian's own native PDF
     view ships the same class names — scoping avoids clashes. */\n\n`;
const root = `/* The container MUST be position:absolute (PDFViewer constructor
   throws otherwise — see src/pdf-view.ts header). inset:0 fills the Obsidian
   leaf; overflow:auto lets PDFViewer scroll internally. height:100% on the root
   makes the absolute container fill the leaf. */\n${ROOT} { height: 100%; }\n${ROOT} .shiyue-pdf-container { position: absolute; inset: 0; overflow: auto; }\n\n`;

writeFileSync(DST, banner + root + scoped + "\n");
console.log(`[shiyue] scoped ${SRC} -> ${DST} (${scoped.length} chars)`);

/** Walk the sheet, rewriting selectors under ROOT. @media/@supports/@container
 *  blocks recurse into their inner sheet; :root → ROOT. */
function scopeSheet(css) {
  let i = 0, out = "";
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (/\s/.test(c)) { out += c; i++; continue; }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const e = end < 0 ? n : end + 2;
      out += css.slice(i, e); i = e; continue;
    }
    if (c === "@") {
      const r = readAtRule(css, i);
      if (r.stmt) { out += r.stmt; i = r.next; continue; }
      out += r.prelude + "{" + scopeSheet(r.inner) + "}";
      i = r.next;
      continue;
    }
    const r = readRule(css, i);
    out += scopeSelectorList(r.sel) + " " + r.block;
    i = r.next;
  }
  return out;
}

/** Read an at-rule starting at i. Returns either a statement at-rule
 *  (@import/@charset — ends at ';', no body) or a block at-rule (@media/
 *  @supports/@container/@keyframes — has { ... } with balanced braces). */
function readAtRule(css, i) {
  let preludeEnd = -1;
  for (let k = i; k < css.length; k++) {
    const ch = css[k];
    if (ch === "{") { preludeEnd = k; break; }
    if (ch === ";") return { stmt: css.slice(i, k + 1), next: k + 1 };
  }
  if (preludeEnd < 0) return { stmt: css.slice(i), next: css.length };
  const prelude = css.slice(i, preludeEnd);
  let k = preludeEnd + 1, d = 1;
  for (; k < css.length && d > 0; k++) {
    const ch = css[k];
    if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  return { prelude, inner: css.slice(preludeEnd + 1, k - 1), next: k };
}

function readRule(css, i) {
  let k = i;
  for (; k < css.length; k++) if (css[k] === "{") break;
  const sel = css.slice(i, k);
  let d = 1, m = k + 1;
  for (; m < css.length && d > 0; m++) {
    const ch = css[m];
    if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  return { sel, block: css.slice(k, m), next: m };
}

/** Split a selector list on TOP-LEVEL commas only (paren-aware), prefix each. */
function scopeSelectorList(sel) {
  const parts = splitTopLevelCommas(sel);
  return parts.map((s) => scopeOne(s.trim())).filter(Boolean).join(", ");
}

function splitTopLevelCommas(s) {
  const out = [];
  let depth = 0, cur = "";
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "(" || ch === "[") { depth++; cur += ch; continue; }
    if (ch === ")" || ch === "]") { depth--; cur += ch; continue; }
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function scopeOne(sel) {
  if (!sel) return sel;
  if (sel === ":root") return ROOT;
  if (sel === ":root *") return ROOT + " *";
  if (sel.startsWith(ROOT)) return sel;
  return ROOT + " " + sel;
}
