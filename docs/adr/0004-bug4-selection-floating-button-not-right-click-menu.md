---
status: accepted
---

# Bug 4: 选区「深抽」走浮按钮,不接管原生右键菜单

选区深抽入口从「预览内右键菜单项」改为「选区附近的浮动按钮」。原生 PDF viewer 的右键菜单(复制成链接、复制为引用等)完整保留,零劫持、零 monkey-patch。

硬约束(经 obsidian.d.ts 验证):公开的 `*-menu` 事件中,`file-menu`/`files-menu` 是文件列表级,`editor-menu` 只对 markdown 编辑器生效(回调给 `Editor`+`MarkdownView`),`url-menu` 是链接级——**原生 PDF viewer 的右键菜单无任何公开 hook**。pdfjs 的 viewer 右键菜单是它自己的 DOM,不走 Obsidian 事件。故「在原生右键菜单里追加项」在 PDF 预览器内不可能用公开 API 做到;唯一能追加的路是 monkey-patch pdfjs 的 contextmenu handler(PDF++ 风格,脆,spec §7 延后)。

在此约束下三选一:① 浮按钮(改交互,零劫持);② 删 viewer 右键、统一走 AI 面板按钮(原生菜单保留,但选区后要移到面板多点一下);③ monkey-patch(违 spec)。选 ①:保留「在选区附近就地触发深抽」的交互直觉(比②少一步),又不碰原生菜单。代价是右键不再有该项,改为 mouseup 后选区旁浮按钮。

实现要点:浮按钮风格须与 Obsidian 原生一致(用 Obsidian CSS 变量 `--text-*`/`--background-*`/`--radius-*`,非硬编码色);定位用 `window.getSelection().getRangeAt(0).getBoundingClientRect()`;消失时机=选区清空 / 点击触发 / 点别处 / 预览 leaf 切换;与 LoadingNotice 协同(深抽进行中浮按钮隐藏或转 disabled)。删 `selection-capture.ts` 里的 contextmenu 监听。
