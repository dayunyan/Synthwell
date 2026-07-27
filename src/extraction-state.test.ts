import { test } from "node:test";
import assert from "node:assert";
import { ExtractionState } from "./extraction-state.ts";

function fakeAdapter() {
  let store: Record<string, any> = {};
  return {
    async exists(p: string) { return p in store; },
    async read(p: string) { return JSON.stringify(store[p] ?? {}); },
    async write(p: string, data: string) { store[p] = JSON.parse(data); },
  } as any;
}

test("ExtractionState: 首次记录某 PDF", async () => {
  const st = new ExtractionState(fakeAdapter());
  await st.record("book.pdf", "hash1", ["飞轮", "网络效应"], "deepseek-v4-flash");
  const r = await st.get("book.pdf");
  assert.deepEqual(r?.point_titles, ["飞轮", "网络效应"]);
  assert.equal(r?.model, "deepseek-v4-flash");
});
test("ExtractionState: 已抽取则返回状态(避免重复)", async () => {
  const a = fakeAdapter(); const st = new ExtractionState(a);
  await st.record("b.pdf", "h", ["t1"], "m");
  const r = await st.get("b.pdf");
  assert.ok(r); assert.equal(r?.point_titles.length, 1);
});
test("ExtractionState: 无记录返回 null", async () => {
  const st = new ExtractionState(fakeAdapter());
  assert.equal(await st.get("never.pdf"), null);
});
