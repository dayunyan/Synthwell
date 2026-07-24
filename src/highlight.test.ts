import { test } from "node:test";
import assert from "node:assert";
import { buildAnchor, resolveAnchor, pageTextFromItems } from "./highlight.ts";

test("buildAnchor + resolveAnchor roundtrip on CJK text", () => {
  const page = "飞轮效应是指一个业务过程中的正向循环，它让强者愈强。";
  const a = buildAnchor("飞轮效应", page, 1);
  assert.equal(a.exact, "飞轮效应");
  assert.equal(a.page, 1);
  const r = resolveAnchor(a, page);
  assert.ok(r, "anchor should resolve");
  assert.equal(page.slice(r!.start, r!.end), "飞轮效应");
});

test("resolveAnchor falls back to exact-only when context drifted", () => {
  const orig = "飞轮效应是指一个业务过程中的正向循环。";
  const a = buildAnchor("飞轮效应", orig, 1);
  // page text changed around the selection (context drift)
  const drifted = "XXX飞轮效应是指YYY一个业务过程中的正向循环。";
  const r = resolveAnchor(a, drifted);
  assert.ok(r, "exact-only fallback should still resolve");
  assert.equal(drifted.slice(r!.start, r!.end), "飞轮效应");
});

test("buildAnchor throws when selection absent", () => {
  assert.throws(() => buildAnchor("不存在", "飞轮效应", 1));
});

test("pageTextFromItems joins CJK without spaces", () => {
  const t = pageTextFromItems([{ str: "飞轮" }, { str: "效应" }, { str: "正向" }]);
  assert.equal(t, "飞轮效应正向");
});
