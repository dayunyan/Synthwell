# 02 — Bug 4: 选区「深抽」改浮按钮,不接管原生右键菜单

**What to build:** 在 PDF 预览里选中文字后,选区附近浮出一个「深读」按钮(就地触发选区深抽),Obsidian 原生右键菜单(复制成链接、复制为引用等)完整保留、零劫持。现状是 `onContextMenu` 里 `preventDefault`/`stopPropagation` 压制了原生菜单只弹我们自己的菜单——删掉这套接管,改浮按钮。硬约束(已验):原生 PDF viewer 右键菜单无公开 hook(`editor-menu` 只对 markdown editor),「往原生菜单追加项」不可能用公开 API,故走浮按钮而非菜单项(ADR-0004)。

**Blocked by:** None — can start immediately.

**What to build (continued):** 浮按钮风格须与 Obsidian 原生一致(用 CSS 变量 `--text-*`/`--background-*`/`--radius-*`,非硬编码色)。定位用 `window.getSelection().getRangeAt(0).getBoundingClientRect()`。消失时机:选区清空 / 点击触发 / 点别处 / 预览 leaf 切换。与 LoadingNotice 协同(深抽进行中浮按钮隐藏或 disabled)。

**Status:** ready-for-human (agent-implemented commit 7d852c1; manual-verify pending)

- [x] 删 `selection-capture.ts` 里的 contextmenu 监听(`onContextMenu` + `preventDefault`/`stopPropagation`)。
- [x] mouseup 后有选区 → 在选区附近浮出「深读」按钮;点击 → 触发 `extractSelection`(与 AI 面板「选区知识点提取」同路径)。
- [x] 浮按钮风格用 Obsidian CSS 变量,与原生一致。
- [x] 浮按钮消失时机:选区清空 / 点击触发 / 点别处 / 预览 leaf 切换。
- [x] 深抽进行中(LoadingNotice 显)浮按钮隐藏或 disabled,不重复触发。
- [x] 原生右键菜单(复制成链接等)完整保留、可正常用。
- [x] `npm run build` clean;测试不回归(91/91 绿)。
- [ ] 人工验:选中文字→浮按钮出;点浮按钮→深抽;右键→原生菜单完整。

## Comments

- 2026-07-29 — agent 实现,commit `7d852c1`(在 `w0-spike`)。新纯模块 `selection-float.ts`(`computeFloatPosition` 选区上下避让定位 + `FloatVisibility` 深抽中隐藏闸,9 个 node:test);`selection-capture.ts` 删 contextmenu 接管、改浮按钮 DOM 胶水,返回 `SelectionCaptureHandle`;`shiyue-workspace.ts` 用 `captureHandle`,`extractSelection` 包 `setExtracting(true/false)` try-finally;`styles.css` 加 `.shiyue-float-deepread`(Obsidian CSS 变量)。`npm run build` clean,`node --test` 91/91 绿。
- 同 commit 内 `shiyue-workspace.ts` 一并带入 #01 并发 WIP(`toggleShiyueSplit` logo 收起 + `isPreviewLeafValid` 走 `containerEl.isConnected`):#02 的 `captureHandle` 改名落在 `toggleShiyueSplit` 内,二者 hunk 级不可分;commit message 已显式标注。#03 extraction 改动已在独立 commit `74e7ef0`,未纳入本 commit。
- 待人工验(最后一项 checkbox):需在真实 Obsidian 中跑,选中文字看浮按钮、点击触发深抽、右键看原生菜单完整。代码层面原生菜单零劫持(已删 contextmenu 监听)。
