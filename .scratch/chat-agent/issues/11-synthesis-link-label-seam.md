# 11 — `synthesisLinkLabel` seam:saveSynthesis 链接标签下沉(Feature Envy + Shotgun Surgery,Standards #7/#8)

**What to build:** `ai-panel-view.ts` `saveSynthesis` 伸手 `AgentReplyEntry.markdown` + `saveTargets` map + 重建链接标签 `汇总 - ${file.basename}`(line 441)——文件名逻辑属 `resolveSynthesisPath` 所在的 seam(`synthesis-note.ts`),不属视图。把链接标签提到 seam 作 `synthesisLinkLabel(trigger)`,与 `resolveSynthesisPath` 同居,消 Shotgun Surgery(改文件名格式不再要同步改视图 + spec)。

**Blocked by:** None — can start immediately(可与 prefactor/behavior 并行;不触 finalize/float 代码段)

**Status:** ready-for-human

- [x] `synthesis-note.ts` 加 `synthesisLinkLabel(triggerBasename: string): string` → `汇总 - ${triggerBasename}`(与 `resolveSynthesisPath` 同格式源;两者共享文件名约定)。
- [x] `ai-panel-view.ts` `saveSynthesis` 用 `synthesisLinkLabel(file.basename)` 替代内联 `汇总 - ${file.basename}`;`panel.msg.synthSaved` 的 `{link}` 传此 seam 结果。
- [x] 单测:`synthesisLinkLabel` 与 `resolveSynthesisPath` 同 basename 产一致前缀(防漂移回归)。
- [x] Feature Envy 减:`saveSynthesis` 仍需读 `entry.markdown` + `saveTargets`(消息模型固有,无法全消),但文件名构造不再在视图。
- [x] 现有测试绿(200 + 新 seam 测);tsc + esbuild clean。实际 218 测试绿(215+3 seam 测)。
- [ ] 手验:汇总 → 存回 → 「已存为综合笔记 [[汇总 - <KP>]]」消息的链接可点开综合笔记(链接与实际文件名一致)。
