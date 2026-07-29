# 04 — 汇总核心: Synthesizer + 关联筛选 + honest-sparse(TDD seam)

**What to build:** 汇总(RAG synthesis)的纯逻辑核心——给定当前知识点 + 其关联笔记,产出带 `[[笔记]](pN)` 引用溯源的综合摘要。关联筛选(共享 ≥1 标签 或 `[[backlink]]` 指向/来自当前笔记,限 20,强关联即带理由的优先排序)→ 组 prompt(当前知识点 + 各关联笔记 summary + 原文片段 + 关联理由)→ LLM → 解析确保引用格式。冷启动诚实降级:关联 ≤1 → 不调 LLM、直接组「单篇聚合视图」+ `sparse:true` 标注。这是本 spec 的单一测试 seam,与 `BatchExtractor`/`SelectionExtractor` 同模式(注入 mock LLM 端到端测)。

**Blocked by:** 03 — shiyue_type 重命名 + batch related 统一带理由(汇总的强关联排序/喂 prompt 依赖每条关联带理由;判定知识点笔记靠 `shiyue_type`)。

**Status:** done (agent-implemented; manual-verify N/A — pure-logic core, fully unit-tested)

- [x] `Synthesizer` 类(core/extraction):注入 `LLMProvider`,`synthesize(input, signal?)` → `{markdown, sparse}`。
- [x] 关联筛选:共享 tag / backlink 命中;>20 截断;强关联(reason 非空)优先排序,同档稳定排序。
- [x] honest-sparse:关联 ≤1 → 不调 LLM、返 `sparse:true` + 单篇聚合 markdown(含各点 summary + 原文片段 + 诚实标注)。
- [x] prompt 组装:含当前知识点 + 各关联笔记 summary + source_text + reason(LLM 据此聚焦强关联)。
- [x] 引用格式:LLM 返文本里 `[[笔记]](pN)` 保留(或 Synthesizer 规范化之)。
- [x] 取消:`signal.aborted` → 不抛、返已组部分 / 空。
- [x] TDD:mock LLM 返 canned synthesis 文本,端到端测上述行为(只测外部行为,不测实现细节)。先例:`batch-extractor.test.ts`、`selection-extractor.test.ts`。
- [x] `npm run build` clean;全量测试绿(108/108:91 baseline + 17 new)。

## Comments

- 2026-07-29 — agent 实现。新增 `src/core/extraction/synthesizer.ts`(`Synthesizer` 类 + `filterAssociated`/`buildSynthesisPrompt`/`buildSparseMarkdown` 纯函数)与 `synthesizer.test.ts`(17 个 node:test)。同 `BatchExtractor`/`SelectionExtractor` 注入 mock `LLMProvider` 模式。
  - **关联筛选**:`filterAssociated(cur, candidates, limit=20)` —— 共享 ≥1 tag(case-insensitive)或 frontmatter `related` backlink 任一方向命中;同名笔记排除(防回环);强关联(reason 非空)优先,同档 source_page 升序再 title 升序稳定排序;>20 截断(强关联即使 page 最大也排首位不被截)。
  - **honest-sparse**:`associated.length <= 1` → 不调 LLM、`buildSparseMarkdown`(当前点 + 各关联点 summary + 原文片段 + 「关联较少…随抽取更多文档…跨文档综合」诚实标注)+ `sparse:true`。
  - **prompt**:`buildSynthesisPrompt` 含当前知识点(title+summary+书+页)+ 各关联笔记(title+summary+source_text+reason,纯 tag 共享标「(纯标签共享)」)+ 要求「每个事实后用 [[笔记标题]](p页码) 标注来源」「优先聚焦带理由的强关联」「不要编造」。prompt 中英混合指令,不随 i18n 改(spec Further Notes)。
  - **引用**:LLM 返文本原样作为 markdown(`[[笔记]](pN)` 保留);规范化/页码跳转延后(spec「保留(或规范化之)」+ Out of Scope「跳转到引用的具体页」)。
  - **取消**:pre-call `signal.aborted` → 返空不抛;chat 抛错时若 `signal.aborted` → 吞错返空,否则抛出交 controller(与 `SelectionExtractor` 同模式)。非 abort 错抛出测试覆盖。
  - **已知 partial(留 #05 wiring)**:`KnowledgeNote` 无 body 字段,backlink 仅查 frontmatter `related`,正文 `[[当前笔记标题]]` backlink 未覆盖(spec 允许)——需 #05 读笔记 body 时补。
- `/code-review`(Standards + Spec 双轴):修了 `reasonFor` 冗余分支(死代码)+ abort-on-error 测试(原 throw `Error("aborted")` 会被「catch 对任意错返空」误过,改 throw 通用错 `stream interrupted` 配对 non-abort-throw 测试,真正 pin abort 吞错语义)。Data Clump(`KnowledgeNote`/`AssociatedNote` 与 `BatchPoint`/`SelectionPoint` 字段重叠)与 title-comparator fork(`sameTitle` exact vs `jaccard` fuzzy)为 judgement call,留待 #05 wiring 若重塑类型时一并收。
