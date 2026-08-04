# 01 — Bug 1+3: 预览 leaf 存活判定 + logo toggle

**What to build:** 点拾阅 logo 第二次点击应收起右侧两屏(toggle:开↔收),而非再 split 一个新预览窗;右键文件列表 `.pdf`「在拾阅中打开」在有预览窗时打开同 split 新标签页、空预览时替换,而非每次堆叠新窗。两者同根因——`isPreviewLeafValid` 用 `getLeavesOfType('pdf').includes(ref)` 对空/刚建预览 leaf(非 'pdf' 类型)返 false,导致 `ensureShiyueSplit` 每次走「recreate preview」分支堆叠新 leaf。修法:把存活判定改为 leaf 容器存活检查;logo 点击改 toggle(split 已存在则收起右栏,否则 ensure)。

**Blocked by:** None — can start immediately.

**Status:** resolved — committed in `7d852c1` (folded w/ #02; captureHandle rename landed inside toggleShiyueSplit, inseparable). build clean, 91/91 tests. code-review (Standards+Spec) clean.

- [x] `isPreviewLeafValid` 改用 `previewLeaf.containerEl.isConnected` 存活检查(空/刚建预览 leaf 也算有效),而非 `getLeavesOfType('pdf').includes`。
- [x] logo onclick 改 toggle:右侧两屏已存在 → 收起(detach 预览 + AI leaf 或收起右栏);不存在 → `ensureShiyueSplit`。第三次点击 = 再开。
- [x] 「在拾阅中打开」:空预览 → `openFile` 替换(不再 recreate 堆叠);有文档预览 → 同 split 新标签页。
- [x] 预览 leaf 关闭后 `layout-change` 复查清 tracker(按钮禁用)仍工作,不回归。
- [x] `npm run build` clean;`node --test --experimental-strip-types $(find src -name '*.test.ts')` 绿不回归(现 91/91:78 base + #02/#13;#01 无新增单测,纯 obsidian 耦合逻辑)。
- [ ] 人工验:点 logo 开/收/再开;右键 `.pdf` 空预览替换、有文档新 tab,不堆新窗。(未跑——需 Obsidian 测试 vault 实测;待人工验)
