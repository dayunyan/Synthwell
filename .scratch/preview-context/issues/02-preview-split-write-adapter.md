# 02 — 深化:#2 PreviewSplit 写侧 adapter(完成 β 读/写 seam)

**What to build:** 把 `ShiyueWorkspace` 里的布局操作(`openInShiyue`/`ensureShiyueSplit`/`toggleShiyueSplit`)抽成 `PreviewSplit` adapter——小 interface 藏大脆性(`duplicateLeaf`/`createLeafBySplit`/`createLeafInParent`/`setActiveLeaf` 的反直觉 + 易碎),读 preview leaf 走 #1 的 `PreviewContext.getPreviewLeaf()`。完成 #1 定的 β 读/写 seam(读=PreviewContext 已成;写=本 ticket)。附带赌注:hasDoc 新 tab 路径试 `createLeafInParent`(空 leaf,不复制视图)替 `duplicateLeaf` → 消 `Transport destroyed` console noise;但须 runtime 验不回归 Bug 3 窗模块。

**Blocked by:** 01 — PreviewContext(本 adapter 读 `previewCtx.getPreviewLeaf()` 取目标 leaf)。

**Status:** ready-for-agent

## 设计(承 #1 的 β seam)

**interface(小,藏大脆性):**
```ts
interface PreviewSplit {
  ensure(): Promise<void>;                // = ensureShiyueSplit(ai-exists?复用:首次建 split)
  toggle(): Promise<void>;                 // = toggleShiyueSplit(开↔收)
  openInPreview(file: TFile): Promise<void>;  // ensure + (hasDoc?新 tab:替换) + openFile
}
```
- leaf 来源:`previewCtx.getPreviewLeaf()`(#1 现派生,不存)。
- `attachPreviewCapture`(浮按钮 DOM 接线)**留 ShiyueWorkspace**(选区相关,非布局);它在 `openInPreview` 后调,读 `previewCtx.getPreviewLeaf()` 取挂载 leaf。
- `ShiyueWorkspace` 持 `PreviewSplit` 实例,`openInShiyue`/logo onclick/命令 改委托它。

**createLeafInParent vs duplicateLeaf(关键赌注,implement-time 验):**
- 现状(#1 后):`setActiveLeaf(preview)` + `duplicateLeaf(preview,"tab")` → tab 对(Bug1 不回归),但 duplicateLeaf 复制 #1 PDF 视图→openFile(#2) destroy → `Transport destroyed` console noise(无害,#1 仍渲染)。
- #2 赌:`createLeafInParent(preview.parent, children.length)` 建**空 leaf**(不复制视图)→ openFile(#2) 现载 → 无 transport churn。**前提**:`preview.parent` 是 WorkspaceTabs(#1 的 derive 已确认 kind=TABS);createLeafInParent 在 WorkspaceTabs 上应加 tab 而非 spawn 窗。早先 Bug 3 的「窗模块」疑是 preview.parent 当年为 SPLIT(不同态)或 transport-destroyed 致 #1 视似破窗。
- **验证 gate**:实现后加 `[DEBUG-ps]` log:createLeafInParent 后 `target.parent === preview.parent`(同组=tab)+ 无 `Transport destroyed` + #1 不破。**若 spawn 窗或 #1 破 → 回退 duplicateLeaf + 接受 noise 为 cosmetic**(已验无害)。不强行。

## Acceptance criteria
- [ ] 新 `src/workspace/preview-split.ts`:`PreviewSplit` 类(implements 上 interface),藏 `duplicateLeaf`/`createLeafBySplit`/`createLeafInParent`/`setActiveLeaf`;构造注入 `app` + `PreviewContext`(读 leaf)+ `aiViewType`。
- [ ] `ShiyueWorkspace`:删 `ensureShiyueSplit`/`toggleShiyueSplit`/`openInShiyue` 的布局实现,委托 `this.previewSplit.ensure/toggle/openInPreview`;`attachPreviewCapture` 留(读 `previewCtx.getPreviewLeaf()`)。`openInPreview`(PanelActions)改委托 `previewSplit.openInPreview`。
- [ ] hasDoc 新 tab 路径用 `createLeafInParent(preview.parent, index)`(替 `duplicateLeaf`)。
- [ ] runtime 验(加 `[DEBUG-ps]`):`createLeafInParent` 后 sameParent=true + 无 Transport destroyed + #1 不破。若回归窗 → 回退 duplicateLeaf + 注释记 cosmetic。
- [ ] `npm run build` clean;`node --test` 161 全绿不回归(PreviewSplit 无纯 seam 可单测——Obsidian 布局 API,人工验;同 #1 写侧)。
- [ ] 人工验(5 项同 #01,确保不回归):开 PDF #1→#2 上方新 tab;native 双击 PDF 进预览区→浮按钮+抽取;synthesis 链接→笔记开预览区;预览有笔记时 open in shiyue PDF 不新建窗;开知识点笔记→面板切汇总。
- [ ] 若 createLeafInParent 成功消 noise:确认 console 干净;若回退 duplicateLeaf:记 Transport noise 为已知 cosmetic(ADR-0004 风格)。

## Out of scope
- 不动 `PreviewContext`(#1 已成,稳定)。
- 不重设计 hasDoc/新tab vs 替换 语义(保 #1 后的行为)。
- `attachPreviewCapture` 不移入 PreviewSplit(选区接线,非布局)。

## Comments
- 2026-08-02 — grill 承 #1 β seam 定。源:architecture-report 候选 #2(Worth exploring)。#1 完结后,写侧是唯一未收进 adapter 的脆性布局 API。createLeafInParent 赌注是附带优化(消 noise),非 #2 主旨——主旨是 locality(布局 fragility 收进小 interface)。
