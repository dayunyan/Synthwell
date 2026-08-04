# 05 — 文档修正(spec §3/§7) + middle-man 保留

**What to build:** 把 code-review 的 2 项 spec 文档修正落到 spec(§3 user-action 时机措辞、§7 撤销 link/page-jump Notice 迁移行),并定 Standards middle-man `synthesisNoteExists` 的处置(保留为 PanelActions seam 代价)。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] spec §3:把「每个按钮 → user-action + agent-reply」澄清为「confirmCost 门是预操作门——点『提炼全书要点』先弹预估模态,消息流无气泡;确认后才弹 user-action + streaming agent-reply;撤回则无 user-action(静默)。selection 无门 → 点按钮即显 user-action。」代码已实现,只校正措辞。
- [ ] spec §7:撤销「`notice.linkNotFound`/`notice.pageJumpUnavailable` → `error`/按钮态」迁移行,改为「这类点击不生成 user-action → 错误消息对不合适,留 `Notice`」。代码已 Notice,无改。
- [ ] Standards middle-man(`synthesisNoteExists`):**保留**为 PanelActions seam(PanelActions 接口一致性 > 一行透传代价);在 `shiyue-workspace.ts` 该方法处加一行注释说明「保留为 PanelActions seam 一致性,非透传冗余」。无代码删除。
