# 01 — 综合笔记存为图谱节点(save-as-new-note 端到端)

**What to build:** 点「存回笔记」(汇总完成后)不再追加 `## 综合汇总` 章节到当前知识点笔记,而是存为一条**综合笔记**——`shiyue_type: synthesis` 的图谱节点,路径 `<synthesisPath>/汇总 - <trigger KP basename>.md`,带 `synthesized_from` 双链(链其源知识点)+ `tags`(全部源知识点 tags 去重并集)。综合笔记在图谱中居知识点之上 → 树状分层可见(分层靠 `synthesized_from` 双链,非 tags)。同一触发 KP 重新汇总 → 覆盖现有综合笔记(点「汇总关联笔记」时 lazy 查存在 → 确认覆盖模态 → 更新 / 取消;文件名稳定,bump `synthesized_at`/`model`/`synthesized_from`/`tags`)。落 ADR-0006 的 schema + 存/更路径(panel UI 仍是旧版,本 slice 不动面板)。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 纯 seam `synthesis-note.ts`:`buildSynthesisNoteContent({triggerTitle, sources: KnowledgeNote[], synthesisMd, model}) -> string`(组 frontmatter:shiyue_type=synthesis / synthesized_from([[KP]] 双链列表) / synthesized_at / model / tags(源 KP tags 去重并集);body:`# 汇总 - <trigger title>` + synthesisMd 原样;无 `## 原文`/`## 关联` 块)+ `resolveSynthesisPath(triggerBasename, synthesisPath) -> string`(→ `<synthesisPath>/汇总 - <trigger basename>.md`)。单测覆盖(对照 `renderNote`/`appendSynthesisSection` 先例:空源、单源、tags 去重、YAML 转义、特殊字符 basename)。
- [ ] `SynthesisController.saveToNote` → `saveSynthesisAsNote(trigger, synthesisMd)`:组源 KP 列表(从汇总时已取的 associated)+ 调 seam;`vault.process` 原子写(存在 → 读改写覆盖 body+frontmatter;新建 → create)。源 KP 列表须含 basename + tags(汇总流程已有 associated: KnowledgeNote[],复用,不重读)。
- [ ] `PanelActions.saveSynthesisToNote` → `saveSynthesisAsNote`;`ShiyueWorkspace` 实现签名对齐(传 trigger + synthesis)。
- [ ] `settings.ts` 加 `synthesisPath`(默认 `拾阅笔记/汇总`);DEFAULT_SETTINGS 补;settings UI 加字段(zh-CN+en label)。
- [ ] 「汇总关联笔记」点击时 lazy 查 `<synthesisPath>/汇总 - <basename>.md` 存在 → 确认覆盖模态(「已存在综合笔记,重新汇总将覆盖,继续?」→ 继续 / 取消);i18n key(zh-CN+en,`satisfies` 双译)。存在性检查在点击 handler 里(非每次 renderContext),避免上下文切换时无谓 IO。
- [ ] 删除 `synth-section.ts` + `appendSynthesisSection` + 其测(ADR-0006:append 章节路径废弃);确认无其他 import 残留。
- [ ] 现有 170 测试绿(`appendSynthesisSection` 相关 9 测随删除移除/转写为综合笔记 seam 测;净增减核)。
- [ ] 手验:汇总一个 KP → 点存回 → vault 出现 `拾阅笔记/汇总/汇总 - <KP>.md`(synthesis 类型 frontmatter,正文带 `[[笔记]](pN)`);图谱显示综合节点链其源 KP;再点汇总 → 覆盖确认 → body 更新、文件名不变。
