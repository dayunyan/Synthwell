# 01 — 综合笔记存为图谱节点(save-as-new-note 端到端)

**What to build:** 点「存回笔记」(汇总完成后)不再追加 `## 综合汇总` 章节到当前知识点笔记,而是存为一条**综合笔记**——`shiyue_type: synthesis` 的图谱节点,路径 `<synthesisPath>/汇总 - <trigger KP basename>.md`,带 `synthesized_from` 双链(链其源知识点)+ `tags`(全部源知识点 tags 去重并集)。综合笔记在图谱中居知识点之上 → 树状分层可见(分层靠 `synthesized_from` 双链,非 tags)。同一触发 KP 重新汇总 → 覆盖现有综合笔记(点「汇总关联笔记」时 lazy 查存在 → 确认覆盖模态 → 更新 / 取消;文件名稳定,bump `synthesized_at`/`model`/`synthesized_from`/`tags`)。落 ADR-0006 的 schema + 存/更路径(panel UI 仍是旧版,本 slice 不动面板)。

**Blocked by:** None — can start immediately

**Status:** ready-for-human

- [x] 纯 seam `synthesis-note.ts`:`buildSynthesisNoteContent({triggerTitle, sources: KnowledgeNote[], synthesisMd, model, synthesizedAt}) -> string`(组 frontmatter:shiyue_type=synthesis / synthesized_from([[KP]] 双链列表,去重) / synthesized_at / model / tags(源 KP tags 去重并集,大小写不敏感保首次);body:`# 汇总 - <trigger title>` + synthesisMd 原样;无 `## 原文`/`## 关联` 块)+ `resolveSynthesisPath(triggerBasename, synthesisPath) -> string`(→ `<synthesisPath>/汇总 - <trigger basename>.md`)。19 单测覆盖(对照 `renderNote` 先例:空源/单源/synthesized_from 去重/tags 去重并集/YAML 不破坏闭合/特殊字符 basename/幂等/末尾换行收敛)。
- [x] `SynthesisController.saveToNote` → `saveSynthesisAsNote(trigger, synthesisMd)`:复用 synthesize 时缓存的源 KP 列表(完整 KnowledgeNote 含 tags,不重读 vault;缓存命中按 lastTriggerPath 验,陈旧则 re-derive)+ 调 seam;`vault.process` 原子覆写(存在 → 全替换 body+frontmatter)/ `ensureFolder`+`vault.create`(新建)。注:`filterAssociated` 返 `AssociatedNote[]`(projection 丢 tags)→ controller 按 title 反匹配已加载 candidates 恢复完整 KnowledgeNote(不重读,功能正确;根因是 AssociatedNote projection 缺 tags,synthesizer 层改超出本 slice)。
- [x] `PanelActions.saveSynthesisToNote` → `saveSynthesisAsNote`;`ShiyueWorkspace` 实现签名对齐(传 trigger + synthesis)+ `synthesisNoteExists` passthrough。
- [x] `settings.ts` 加 `synthesisPath`(默认 `拾阅笔记/汇总`);DEFAULT_SETTINGS 补;settings UI 加字段(zh-CN+en label,MESSAGES `satisfies` 强制双译)。
- [x] 「汇总关联笔记」点击时 lazy 查 `<synthesisPath>/汇总 - <basename>.md` 存在 → `confirmOverwriteSynthesis` 确认覆盖模态(「已存在综合笔记,重新汇总将覆盖,继续?」→ 继续 / 取消);i18n key `synth.overwrite.*`(zh-CN+en,`satisfies` 双译)。存在性检查在点击 handler `startSynthesis` 里(非每次 renderContext),避免上下文切换时无谓 IO(纯内存 getAbstractFileByPath)。
- [x] 删除 `synth-section.ts` + `appendSynthesisSection` + 9 测(ADR-0006:append 章节路径废弃);grep 确认无 import 残留。
- [x] 测试绿:180 pass / 0 fail(170 基线 −9 synth-section +19 synthesis-note = 180,净增减核);tsc + esbuild clean。
- [ ] 手验:汇总一个 KP → 点存回 → vault 出现 `拾阅笔记/汇总/汇总 - <KP>.md`(synthesis 类型 frontmatter,正文带 `[[笔记]](pN)`);图谱显示综合节点链其源 KP;再点汇总 → 覆盖确认 → body 更新、文件名不变。

**实现:** commit d0a613a(w0-spike)。**待人工验:** 上方手验项 + ADR-0006 标注的阅读视图 `(pN)` 跳转 affordance 暂缺(综合笔记在 Obsidian 原生阅读视图打开时 `(pN)` 渲为纯文本,`[[笔记]]` 双链仍可用;后续版本补 reading-view decorator)。

**code-review 笺注(2026-08-03):**
- 术语张力:CONTEXT.md glossary _Avoid_ 汇总节点/汇总笔记(用综合笔记);本 slice 在文件名/H1/默认路径用裸 `汇总`(动作术语,glossary 仅避复合名词),由 ADR-0006 + 本 issue checklist 明确指定 → spec 优先,未改。若要统一为 `综合`,重开 ADR-0006。
- `sourcesFrom` 按 title 反匹配 associated 恢复完整 KnowledgeNote(AssociatedNote projection 丢 tags 的 workaround;不重读 vault,功能正确)。
- `confirmOverwriteSynthesis` 键内化(与 confirmCost 同模式,消 Speculative Generality)。
