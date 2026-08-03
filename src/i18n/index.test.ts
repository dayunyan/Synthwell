import { test } from "node:test";
import assert from "node:assert/strict";
import { t, setLocale, getLocale, detectLocale, MESSAGES } from "./index.ts";

// ── detectLocale ───────────────────────────────────────────────────────────

test("detectLocale: momentLocale zh → zh-CN", () => {
  assert.equal(detectLocale({ momentLocale: () => "zh-cn" }), "zh-CN");
});

test("detectLocale: navigator en-US → en", () => {
  assert.equal(detectLocale({ navigatorLanguage: () => "en-US" }), "en");
});

test("detectLocale: momentLocale 优先于 navigator(冲突时)", () => {
  assert.equal(detectLocale({ momentLocale: () => "zh-cn", navigatorLanguage: () => "en-US" }), "zh-CN");
});

test("detectLocale: 检测到但不支持的语言(如 fr)→ en 回退", () => {
  assert.equal(detectLocale({ navigatorLanguage: () => "fr-FR" }), "en");
});

test("detectLocale: 无任何信号 → zh-CN(CJK-first 默认)", () => {
  assert.equal(detectLocale({}), "zh-CN");
});

test("detectLocale: 大小写不敏感(ZH-TW → zh-CN)", () => {
  assert.equal(detectLocale({ navigatorLanguage: () => "ZH-TW" }), "zh-CN");
});

test("detectLocale: navigator zh-CN → zh-CN", () => {
  assert.equal(detectLocale({ navigatorLanguage: () => "zh-CN" }), "zh-CN");
});

// ── t + setLocale + getLocale ───────────────────────────────────────────────

test("t: 默认 zh-CN,返回 zh 文案", () => {
  setLocale("zh-CN");
  assert.equal(t("panel.btn.batch"), "提炼全书要点");
});

test("t: setLocale en 后返回 en 文案", () => {
  const saved = getLocale();
  setLocale("en");
  try { assert.equal(t("panel.btn.batch"), "Refine book highlights"); }
  finally { setLocale(saved); }
});

test("t: 参数替换(zh)", () => {
  setLocale("zh-CN");
  assert.equal(t("extract.msg.selectionDone", { title: "飞轮" }), "✓ 已提炼:飞轮");
});

test("t: 参数替换(en)", () => {
  const saved = getLocale();
  setLocale("en");
  try { assert.equal(t("extract.msg.selectionDone", { title: "Flywheel" }), "✓ Refined: Flywheel"); }
  finally { setLocale(saved); }
});

test("t: 多参数替换", () => {
  setLocale("zh-CN");
  assert.equal(
    t("extract.progress", { done: 2, total: 5, points: 8 }),
    "2/5 → 8 点",
  );
});

test("t: 缺失 key → 回退到 key 字符串", () => {
  setLocale("zh-CN");
  assert.equal(t("nonexistent.key" as never), "nonexistent.key");
});

test("t: 返回值不缓存当前 locale——setLocale 即时生效", () => {
  setLocale("zh-CN");
  assert.equal(t("loading.stop"), "停止");
  setLocale("en");
  assert.equal(t("loading.stop"), "Stop");
  setLocale("zh-CN");
});

// ── MESSAGES 完整性(每条都有两语言,无遗漏)────────────────────────────

test("MESSAGES: 每条都有 zh-CN 与 en 字符串", () => {
  for (const [k, v] of Object.entries(MESSAGES)) {
    assert.equal(typeof v["zh-CN"], "string", `${k} 缺 zh-CN`);
    assert.equal(typeof v.en, "string", `${k} 缺 en`);
    assert.ok((v["zh-CN"] as string).length > 0, `${k} 的 zh-CN 为空串`);
    assert.ok(v.en.length > 0, `${k} 的 en 为空串`);
  }
});

test("MESSAGES: 所有占位符 {x} 两语言一致(zh/en 同名参数集)", () => {
  const placeholders = (s: string): string[] =>
    (s.match(/\{(\w+)\}/g) ?? []).sort();
  for (const [k, v] of Object.entries(MESSAGES)) {
    assert.deepEqual(
      placeholders(v["zh-CN"]),
      placeholders(v.en),
      `${k}: zh 与 en 占位符不一致`,
    );
  }
});
