# 03 — Prefactor: shiyue_type 重命名 + batch related 统一带理由

**What to build:** 两件机械性前置改造(为汇总铺路,趁未发布、零存量):(1) 知识点笔记 frontmatter 标识键 `synthwell_type` → `shiyue_type`(ADR-0001);(2) batch 抽取的 `related` 字段从纯标题 `string[]` 统一为 `{title, reason}[]`,与 selection 对齐——`extractChunk` 的 prompt 改为要求 `related: [{"title","reason"}]`,`normalizePoint` 改为处理该形状(兼容 LLM 仍返字符串的退化)。汇总的强关联排序/喂 prompt 依赖每条关联带理由(CONTEXT「关联理由」),故须先于汇总落。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] note-generator 的 frontmatter 标识键 `synthwell_type` → `shiyue_type`;note-generator.test.ts 的断言同步改。
- [x] `BatchPoint.related` 类型从 `string[]` → `{title, reason}[]`;`normalizePoint` 处理 `{title,reason}[]`(LLM 返字符串时退化兼容:`{title: str, reason: ""}`)。
- [x] `extractChunk` prompt 改为要求 `related: [{"title","reason"}]`(每条关联附一句理由)。
- [x] note-generator 的 `related`/`related_reasons` 渲染对 batch 也带理由(已有 `related_reasons` 字段与 `## 关联` 渲染,body 显示理由)。
- [x] 现有 batch/selection/normalize 测试更新断言不回归;新增「LLM 返字符串 related 的退化兼容」测试。
- [x] `npm run build` clean;全量测试绿(91 pass)。
