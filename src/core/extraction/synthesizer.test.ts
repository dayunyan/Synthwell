import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Synthesizer,
  filterAssociated,
  buildSynthesisPrompt,
  buildSparseMarkdown,
  type KnowledgeNote,
  type AssociatedNote,
  type SynthesisInput,
} from "./synthesizer.ts";
import type { LLMProvider, ChatMsg } from "../llm/llm-service.ts";

/** 造一个 mock LLMProvider:chat 返回 canned 文本,并可捕获 prompt / opts。 */
function mockLLM(reply: string): { llm: LLMProvider; captured: () => string; opts: () => any; calls: () => number } {
  let captured = "";
  let opts: any;
  let calls = 0;
  const llm: LLMProvider = {
    async chat(msgs: ChatMsg[], o?: any) { calls++; captured = msgs[0].content ?? msgs[msgs.length - 1].content; opts = o; return reply; },
    async *stream() { throw new Error("no"); },
    abort() {},
  };
  return { llm, captured: () => captured, opts: () => opts, calls: () => calls };
}

function note(o: Partial<KnowledgeNote>): KnowledgeNote {
  return {
    title: o.title ?? "T",
    summary: o.summary ?? "s",
    source_pdf: o.source_pdf ?? "书.pdf",
    source_page: o.source_page ?? 1,
    source_text: o.source_text ?? "原文",
    tags: o.tags ?? [],
    related: o.related ?? [],
  };
}

// ── filterAssociated ──────────────────────────────────────────────────────

test("filterAssociated: 共享 tag 命中", () => {
  const cur = note({ title: "飞轮", tags: ["增长"] });
  const cands = [note({ title: "网络效应", tags: ["增长"] }), note({ title: "无关", tags: ["别的"] })];
  const out = filterAssociated(cur, cands);
  assert.deepEqual(out.map(a => a.title), ["网络效应"]);
  assert.equal(out[0].reason, "", "纯 tag 共享 → reason 为空");
});

test("filterAssociated: backlink 命中——current.related 指向 candidate(带理由)", () => {
  const cur = note({ title: "飞轮", tags: [], related: [{ title: "网络效应", reason: "都讲平台价值随用户增长" }] });
  const cands = [note({ title: "网络效应", tags: ["别的"] })];
  const out = filterAssociated(cur, cands);
  assert.deepEqual(out.map(a => a.title), ["网络效应"]);
  assert.equal(out[0].reason, "都讲平台价值随用户增长");
});

test("filterAssociated: backlink 命中——candidate.related 指向 current(带理由)", () => {
  const cur = note({ title: "飞轮", tags: [] });
  const cands = [note({ title: "网络效应", tags: ["别的"], related: [{ title: "飞轮", reason: "反向引用" }] })];
  const out = filterAssociated(cur, cands);
  assert.deepEqual(out.map(a => a.title), ["网络效应"]);
  assert.equal(out[0].reason, "反向引用");
});

test("filterAssociated: backlink 命中但理由为空(退化)→ 关联但 reason 空", () => {
  const cur = note({ title: "飞轮", tags: [], related: [{ title: "网络效应", reason: "" }] });
  const cands = [note({ title: "网络效应", tags: ["别的"] })];
  const out = filterAssociated(cur, cands);
  assert.equal(out.length, 1);
  assert.equal(out[0].reason, "");
});

test("filterAssociated: 不共享 tag 也无 backlink → 排除", () => {
  const cur = note({ title: "飞轮", tags: ["增长"] });
  const cands = [note({ title: "X", tags: ["别的"], related: [{ title: "Y", reason: "z" }] })];
  assert.equal(filterAssociated(cur, cands).length, 0);
});

test("filterAssociated: 强关联(reason 非空)优先于纯 tag 共享;同档稳定排序", () => {
  const cur = note({ title: "飞轮", tags: ["增长"], related: [{ title: "强关联B", reason: "理由B" }] });
  // 故意把 tag-only 的放前面、source_page 放前面,验证强关联仍排在前
  const cands = [
    note({ title: "tagOnlyA", source_page: 1, tags: ["增长"] }),           // 纯 tag,page 1
    note({ title: "强关联B", source_page: 9, tags: ["增长"] }),            // 强关联(reason 来自 current.related),page 9
    note({ title: "强关联C", source_page: 3, related: [{ title: "飞轮", reason: "理由C" }] }), // 强关联,page 3
    note({ title: "tagOnlyD", source_page: 2, tags: ["增长"] }),           // 纯 tag,page 2
  ];
  const out = filterAssociated(cur, cands);
  // 强关联档:page 升序 → 强关联C(3) 在 强关联B(9) 前;再 tag 档:page 升序 → tagOnlyA(1), tagOnlyD(2)
  assert.deepEqual(out.map(a => a.title), ["强关联C", "强关联B", "tagOnlyA", "tagOnlyD"]);
  assert.equal(out[0].reason, "理由C");
  assert.equal(out[1].reason, "理由B");
  assert.equal(out[2].reason, "");
  assert.equal(out[3].reason, "");
});

test("filterAssociated: >20 截断(强关联优先保留)", () => {
  const cur = note({ title: "飞轮", tags: ["增长"], related: [{ title: "强关联", reason: "理由" }] });
  const cands: KnowledgeNote[] = [];
  for (let i = 0; i < 25; i++) cands.push(note({ title: `tag${i}`, source_page: i + 1, tags: ["增长"] }));
  cands.push(note({ title: "强关联", source_page: 999, tags: ["增长"] }));
  const out = filterAssociated(cur, cands, 20);
  assert.equal(out.length, 20, "截断到 20");
  assert.equal(out[0].title, "强关联", "强关联即使 page 最大也排首位不被截掉");
});

test("filterAssociated: 不含 current 自身(即便同名也不回环)", () => {
  const cur = note({ title: "飞轮", tags: ["增长"] });
  const cands = [note({ title: "飞轮", tags: ["增长"] })];
  // 同名笔记:共享 tag,但应排除 current 自身(标题相同视为自身)
  assert.equal(filterAssociated(cur, cands).length, 0);
});

// ── buildSparseMarkdown ───────────────────────────────────────────────────

test("buildSparseMarkdown: 含当前知识点 + 各关联点 summary + 原文片段 + 诚实标注", () => {
  const input: SynthesisInput = {
    current: note({ title: "飞轮", summary: "正向循环让强者愈强", source_text: "飞轮效应是指…" }),
    associated: [note({ title: "网络效应", summary: "平台价值随用户增长", source_text: "网络效应原文" }) as unknown as AssociatedNote],
  };
  const md = buildSparseMarkdown(input);
  assert.ok(md.includes("飞轮"), "含当前知识点标题");
  assert.ok(md.includes("正向循环让强者愈强"), "含当前知识点 summary");
  assert.ok(md.includes("网络效应"), "含关联点标题");
  assert.ok(md.includes("平台价值随用户增长"), "含关联点 summary");
  assert.ok(md.includes("网络效应原文"), "含关联点原文片段");
  assert.ok(md.includes("关联较少") || md.includes("随抽取更多文档"), "含诚实标注");
});

// ── Synthesizer.synthesize: honest-sparse ────────────────────────────────

test("synthesize: associated ≤1(0 条)→ 不调 LLM、sparse:true、单篇聚合 markdown", async () => {
  const { llm, calls } = mockLLM("不该被调用");
  const synth = new Synthesizer(llm);
  const res = await synth.synthesize({ current: note({ title: "飞轮", summary: "正向循环" }), associated: [] });
  assert.equal(res.sparse, true);
  assert.equal(calls(), 0, "不调 LLM");
  assert.ok(res.markdown.includes("飞轮"), "markdown 含当前知识点");
  assert.ok(res.markdown.includes("关联较少") || res.markdown.includes("随抽取更多文档"), "含诚实标注");
});

test("synthesize: associated === 1 → 仍 sparse(不调 LLM)", async () => {
  const { llm, calls } = mockLLM("不该被调用");
  const synth = new Synthesizer(llm);
  const res = await synth.synthesize({
    current: note({ title: "飞轮", summary: "正向循环" }),
    associated: [{ title: "网络效应", summary: "平台价值", source_pdf: "书.pdf", source_page: 3, source_text: "原文", reason: "" }],
  });
  assert.equal(res.sparse, true);
  assert.equal(calls(), 0);
  assert.ok(res.markdown.includes("网络效应"));
});

// ── Synthesizer.synthesize: 正常综合 ─────────────────────────────────────

test("synthesize: associated >1 → 调 LLM,prompt 含当前知识点 + 各关联 summary + source_text + reason", async () => {
  const reply = "综合:飞轮与网络效应都讲平台正反馈 [[网络效应]](p3)。";
  const { llm, captured } = mockLLM(reply);
  const synth = new Synthesizer(llm);
  const input: SynthesisInput = {
    current: note({ title: "飞轮", summary: "正向循环让强者愈强", source_pdf: "增长策略.pdf", source_page: 5 }),
    associated: [
      { title: "网络效应", summary: "平台价值随用户增长", source_pdf: "平台革命.pdf", source_page: 3, source_text: "网络效应原文片段", reason: "都讲平台正反馈" },
      { title: "好战略", summary: "战略的核心是取舍", source_pdf: "好战略坏战略.pdf", source_page: 12, source_text: "好战略原文片段", reason: "" },
    ],
  };
  const res = await synth.synthesize(input);
  assert.equal(res.sparse, false);
  const p = captured();
  assert.ok(p.includes("飞轮"), "prompt 含当前知识点标题");
  assert.ok(p.includes("正向循环让强者愈强"), "prompt 含当前知识点 summary");
  assert.ok(p.includes("网络效应"), "prompt 含关联笔记标题");
  assert.ok(p.includes("平台价值随用户增长"), "prompt 含关联笔记 summary");
  assert.ok(p.includes("网络效应原文片段"), "prompt 含关联笔记 source_text");
  assert.ok(p.includes("都讲平台正反馈"), "prompt 含关联理由");
  assert.ok(p.includes("[[笔记") || p.includes("[[标题") || p.includes("(p"), "prompt 要求引用格式");
});

test("synthesize: LLM 返回文本里的 [[笔记]](pN) 引用保留在 markdown", async () => {
  const reply = "飞轮与网络效应都讲正反馈 [[网络效应]](p3),亦见 [[好战略]](p12)。";
  const { llm } = mockLLM(reply);
  const synth = new Synthesizer(llm);
  const input: SynthesisInput = {
    current: note({ title: "飞轮" }),
    associated: [
      { title: "网络效应", summary: "s1", source_pdf: "a.pdf", source_page: 3, source_text: "t1", reason: "r1" },
      { title: "好战略", summary: "s2", source_pdf: "b.pdf", source_page: 12, source_text: "t2", reason: "r2" },
    ],
  };
  const res = await synth.synthesize(input);
  assert.ok(res.markdown.includes("[[网络效应]](p3)"), "引用保留");
  assert.ok(res.markdown.includes("[[好战略]](p12)"), "第二条引用保留");
  assert.equal(res.sparse, false);
});

test("synthesize: signal 透传 llm.chat opts", async () => {
  const reply = "x [[网络效应]](p3)。";
  let capturedOpts: any;
  const llm: LLMProvider = {
    async chat(_m, o) { capturedOpts = o; return reply; },
    async *stream() { throw 0; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const ctrl = new AbortController();
  await synth.synthesize({
    current: note({ title: "飞轮" }),
    associated: [
      { title: "网络效应", summary: "s", source_pdf: "a", source_page: 3, source_text: "t", reason: "r" },
      { title: "好战略", summary: "s", source_pdf: "b", source_page: 4, source_text: "t", reason: "r" },
    ],
  }, ctrl.signal);
  assert.equal(capturedOpts.signal, ctrl.signal);
});

test("synthesize: signal 已 aborted → 不调 LLM、不抛、返空 markdown", async () => {
  let calls = 0;
  const llm: LLMProvider = {
    async chat() { calls++; return "x"; },
    async *stream() { throw 0; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await synth.synthesize({
    current: note({ title: "飞轮" }),
    associated: [
      { title: "网络效应", summary: "s", source_pdf: "a", source_page: 3, source_text: "t", reason: "r" },
      { title: "好战略", summary: "s", source_pdf: "b", source_page: 4, source_text: "t", reason: "r" },
    ],
  }, ctrl.signal);
  assert.equal(calls, 0, "已取消则不调 LLM");
  assert.equal(res.markdown, "");
  assert.equal(res.sparse, false);
});

test("synthesize: signal 已 abort → LLM 抛任意错也不抛、返空 markdown(abort 吞错,非消息匹配)", async () => {
  const llm: LLMProvider = {
    async chat() { throw new Error("stream interrupted"); },  // 通用错,非字面 "aborted"
    async *stream() { throw 0; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const ctrl = new AbortController();
  ctrl.abort();
  const res = await synth.synthesize({
    current: note({ title: "飞轮" }),
    associated: [
      { title: "网络效应", summary: "s", source_pdf: "a", source_page: 3, source_text: "t", reason: "r" },
      { title: "好战略", summary: "s", source_pdf: "b", source_page: 4, source_text: "t", reason: "r" },
    ],
  }, ctrl.signal);
  assert.equal(res.markdown, "");
  assert.equal(res.sparse, false);
});

test("synthesize: 非 abort 错 → 抛出(交 controller 友好提示)", async () => {
  const llm: LLMProvider = {
    async chat() { throw new Error("网络错误"); },
    async *stream() { throw 0; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  await assert.rejects(() => synth.synthesize({
    current: note({ title: "飞轮" }),
    associated: [
      { title: "网络效应", summary: "s", source_pdf: "a", source_page: 3, source_text: "t", reason: "r" },
      { title: "好战略", summary: "s", source_pdf: "b", source_page: 4, source_text: "t", reason: "r" },
    ],
  }), /网络错误/);
});

// ── Synthesizer.synthesizeStream: 流式 ────────────────────────────────────

/** 造一个流式 mock:逐段 yield deltas;可捕获 prompt / opts。 */
function mockStream(deltas: string[]): { llm: LLMProvider; captured: () => string; opts: () => any } {
  let captured = ""; let opts: any;
  const llm: LLMProvider = {
    async chat() { throw new Error("no"); },
    async *stream(msgs: ChatMsg[], o?: any) { opts = o; captured = msgs[0].content; for (const d of deltas) yield d; },
    abort() {},
  };
  return { llm, captured: () => captured, opts: () => opts };
}

const TWO = [
  { title: "网络效应", summary: "s1", source_pdf: "a.pdf", source_page: 3, source_text: "t1", reason: "r1" },
  { title: "好战略", summary: "s2", source_pdf: "b.pdf", source_page: 12, source_text: "t2", reason: "r2" },
] as const;

test("synthesizeStream: sparse(0 关联)→ 一帧完整单篇聚合,sparse:true,不调 stream", async () => {
  let calls = 0;
  const llm: LLMProvider = {
    async chat() { return ""; },
    async *stream() { calls++; throw 0; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const out: any[] = [];
  for await (const c of synth.synthesizeStream({ current: note({ title: "飞轮", summary: "正向循环" }), associated: [] })) out.push(c);
  assert.equal(calls, 0, "不调 stream");
  assert.equal(out.length, 1, "一帧");
  assert.equal(out[0].sparse, true);
  assert.ok(out[0].markdown.includes("飞轮"));
});

test("synthesizeStream: 关联 >1 → 增量 yield 累积 markdown,末帧为完整拼接,sparse:false", async () => {
  const { llm, captured } = mockStream(["飞轮", "与", "[[网络效应]](p3)。"]);
  const synth = new Synthesizer(llm);
  const out: any[] = [];
  for await (const c of synth.synthesizeStream({ current: note({ title: "飞轮" }), associated: [...TWO] })) out.push(c);
  assert.ok(out.length >= 3, "至少 3 帧(逐 delta)");
  assert.equal(out.at(-1)!.markdown, "飞轮与[[网络效应]](p3)。", "末帧为完整拼接");
  assert.equal(out.at(-1)!.sparse, false);
  assert.ok(out[1].markdown.startsWith("飞轮与"), "中间帧为累积");
  assert.ok(captured().includes("飞轮"), "prompt 含当前知识点");
});

test("synthesizeStream: signal 透传 llm.stream opts", async () => {
  let capturedOpts: any;
  const llm: LLMProvider = {
    async chat() { throw 0; },
    async *stream(_m, o) { capturedOpts = o; yield "x"; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const ctrl = new AbortController();
  for await (const _ of synth.synthesizeStream({ current: note({ title: "飞轮" }), associated: [...TWO] }, ctrl.signal)) { /* drain */ }
  assert.equal(capturedOpts.signal, ctrl.signal);
});

test("synthesizeStream: 中途 abort → 停止迭代、不抛,已 yield 部分保留", async () => {
  const ctrl = new AbortController();
  let i = 0;
  const llm: LLMProvider = {
    async chat() { throw 0; },
    async *stream() {
      for (const d of ["a", "b", "c", "d"]) {
        if (i === 2) ctrl.abort();  // 第三段前取消
        i++;
        yield d;
      }
    },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const out: string[] = [];
  for await (const c of synth.synthesizeStream({ current: note({ title: "飞轮" }), associated: [...TWO] }, ctrl.signal)) out.push(c.markdown);
  // 取消后不再 yield 新帧;已 yield 的 "a"/"ab" 保留(不抛)
  assert.ok(out.length <= 3, "取消后停止");
  assert.ok(!out.some(m => m.includes("d")), "未到 d 即停");
});

test("synthesizeStream: 进入前已 abort → 不调 stream、不抛、零帧", async () => {
  let calls = 0;
  const llm: LLMProvider = {
    async chat() { throw 0; },
    async *stream() { calls++; yield "x"; },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  const ctrl = new AbortController();
  ctrl.abort();
  const out: any[] = [];
  for await (const c of synth.synthesizeStream({ current: note({ title: "飞轮" }), associated: [...TWO] }, ctrl.signal)) out.push(c);
  assert.equal(calls, 0);
  assert.equal(out.length, 0);
});

test("synthesizeStream: 非 abort 错 → 抛出", async () => {
  const llm: LLMProvider = {
    async chat() { throw 0; },
    async *stream() { throw new Error("网络错误"); },
    abort() {},
  };
  const synth = new Synthesizer(llm);
  await assert.rejects(async () => {
    for await (const _ of synth.synthesizeStream({ current: note({ title: "飞轮" }), associated: [...TWO] })) { /* drain */ }
  }, /网络错误/);
});
