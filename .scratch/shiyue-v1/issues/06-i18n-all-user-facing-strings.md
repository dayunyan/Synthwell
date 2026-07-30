# 06 — i18n: 所有 user-facing 字符串跟随系统语言(Plan D)

**What to build:** 所有 user-facing 字符串(按钮、菜单项、Notice、命令名、设置面板、汇总/浮按钮新串)抽到 locale map(至少 zh-CN + en),检测系统语言(`window.moment?.locale()` / `navigator.language`)切换。措辞优化(「抽取整篇知识点」→「提炼全书要点」;「深抽这个知识点」→「精读选中」/「深读这一段」;「选区知识点提取」→「提炼选中要点」;「汇总这个知识点」→ 待定;具体措辞实现期定)。放最后——因重写所有字符串,而前面 ticket(汇总/浮按钮)会引入新串,最后做 i18n 让每个字符串只重写一次(ADR-0003)。

**Blocked by:** 01, 02, 04, 05 — 所有引入 user-facing 字符串的 ticket 完成后(汇总 + 浮按钮的新串在此统一抽 locale)。

**Status:** ready-for-human

- [x] locale map(zh-CN + en 至少),检测系统语言切换。
- [x] 所有 user-facing 字符串抽到 locale:AI 面板按钮、浮按钮、命令名、Notice、设置面板、汇总按钮/标注。
- [x] 措辞优化(具体措辞实现期与用户定)。
- [x] LLM prompt **不**随 i18n 改(中英混合指令给模型,改语言影响质量)——只 user-facing 字符串走 i18n。
- [x] `npm run build` clean;全量测试绿(149/149:131 base + 16 i18n + 2 synthesizer en/zh)。
- [ ] 人工验:切系统语言→界面文字切换;中文/英文都正常。

## Comments

- 2026-07-30 — agent 实现。新增纯逻辑 `src/i18n/index.ts`(`MESSAGES` zh-CN+en 双语 map + `detectLocale` + `setLocale`/`getLocale` + `t(key, params?)`)+ `src/i18n/index.test.ts`(16 个 node:test:检测优先级 / 回退 / 参数替换 / MESSAGES 完整性与占位符一致性)。`t()` 用 `split().join()` 替换 `{占位符}`;`MESSAGES satisfies Record<string,{zh-CN,en}>` 编译期强制每条两语言,`MessageKey` 派生自 `keyof typeof MESSAGES`,调用点拼写错即编译错。
  - **检测**:`detectLocale` 探 `window.moment?.locale()`(Obsidian 语言设置)优先,次 `navigator.language`;`zh*`→zh-CN,`en*`→en,检测到但不支持(如 fr)→ en 回退,无信号 → zh-CN(CJK-first 默认)。大小写不敏感。`main.onload` 调 `setLocale(detectLocale())`。模块顶层无副作用(不在 import 时探 window),故 node:test 可安全加载。
  - **措辞(与用户定)**:整篇按钮/命令 → 「提炼全书要点」(Refine book highlights);选区按钮/命令 → 「提炼选中要点」(Refine selection);选区浮按钮 → 「精读选中」(Close-read selection);汇总按钮(原「汇总这个知识点」待定)→ 「汇总关联笔记」(Synthesize related notes)。其余 UI 串原样抽 locale,未改措辞。
  - **覆盖范围**:命令名(main.ts)、设置面板(settings-tab.ts,含下拉选项 label)、AI 面板(按钮/占位/提示/汇总中/错误前缀,file-menu 菜单项,浮按钮,loading「停止」,confirm 弹窗,工作区 Notice + picker,抽取控制器 Notice/进度/label,synthesis-controller 抛错文案)。progress 回调参数 `(d,t,p)` 重命名 `(done,total,points)` 避与导入的 `t` 撞。
  - **honest-sparse 综合视图**:`buildSparseMarkdown` 渲染给用户的 markdown 走 `t()`(标题/诚实标注/小节名/原文片段标签);zh 文案**逐字不变**(只过 locale map)→ 现有 `synthesizer.test.ts` 断言全绿。新增 2 个测试:en locale 产英文、zh-CN 默认不回归。
  - **不 i18n 的**:`buildSynthesisPrompt`(中英混合 LLM 指令,改语言影响质量,issue 明确排除);`contextPages` 的 `第N页:` 标签(喂进 selection prompt 的上下文,非 user-facing);`📖` logo emoji;`《书名》` 引用标记(两语言同形,留 code literal);`拾阅 / Shiyue` 品牌标题(两语言同形)。
  - **架构**:`i18n/index.ts` 不 import obsidian(同 settings-tab.ts 注的 obsidian `main:""` types-only 约束),纯逻辑可单测;obsidian 耦合的 UI 模块(按钮/Notice/设置)无单测,人工验。
  - `npm run build` clean;`tsc` 0 错;`node --test` 149/149 绿。人工验待办:切系统语言→重开 Obsidian / 重开面板 → 文字切换;中/英两态正常。
