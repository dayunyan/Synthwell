import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyContext } from "./panel-context.ts";

const pdf = { extension: "pdf" } as any;
const kp = (ext = "md") => ({ extension: ext } as any);
const fm = (t?: string) => (t ? { shiyue_type: t } : {}) as any;

test("classifyContext: null 文件 → none", () => {
  assert.equal(classifyContext(null, fm("knowledge_point")), "none");
});

test("classifyContext: PDF → pdf", () => {
  assert.equal(classifyContext(pdf, null), "pdf");
});

test("classifyContext: md + shiyue_type=knowledge_point → knowledge-point", () => {
  assert.equal(classifyContext(kp(), fm("knowledge_point")), "knowledge-point");
});

test("classifyContext: md 但 shiyue_type 非 knowledge_point → none(普通 md 禁用)", () => {
  assert.equal(classifyContext(kp(), fm("other")), "none");
  assert.equal(classifyContext(kp(), fm()), "none");
});

test("classifyContext: md 无 frontmatter → none", () => {
  assert.equal(classifyContext(kp(), null), "none");
});

test("classifyContext: 其它扩展名(如 canvas/json)→ none", () => {
  assert.equal(classifyContext({ extension: "canvas" } as any, null), "none");
});
