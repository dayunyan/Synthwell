---
status: accepted
---

# 综合笔记存为独立图谱节点(非追加 `## 综合汇总` 章节)

阶段 1 spec §6「保存(可选)」与 #07(commit 937f28d)把汇总追加到当前知识点笔记的 `## 综合汇总` 章节(`appendSynthesisSection`)。#4 用户反馈要求改为存为**独立笔记**——类型 `shiyue_type: synthesis`,经 `synthesized_from` 双链挂其源知识点——使汇总成为图谱中可见的聚合层节点(知识点叶 → 综合笔记聚合层,树状分层),而非埋在知识点笔记内的章节(图谱不可见)。

frontmatter:`synthesized_from`(源知识点 `[[KP]]` 双链,图谱边)+ `synthesized_at`/`model`(溯源,重汇总更新)+ `tags`(全部源知识点 tags 去重并集,供标签面板/过滤,**非图谱边**——分层靠 `synthesized_from` 双链,非 tags);body = Synthesizer 流式输出(`[[笔记]](pN)` 溯源),无 `## 原文`/`## 关联` 块(那些是知识点专属)。重汇总 = **更新**(一触发 KP 一综合笔记,刷新 body + bump `synthesized_at`/`model`/`synthesized_from`/`tags`,文件名稳定 `汇总 - <trigger basename>.md`,路径 `<synthesisPath>/` 默认 `拾阅笔记/汇总`)。

## 取舍

节点 vs 章节。节点买图谱树状分层 + 持久可引用;代价是更多文件 + frontmatter schema + 重汇总策略 + 覆盖风险(用户手改被刷,UI 提示)。spec §6 的「追加章节」更简但图谱不可见——#4 反馈显式要图谱分层,接受迁移成本。后期聊天 Agent 把「汇总」包成 tool 时,tool 产出即此综合笔记。

## Consequences

- **`## 综合汇总` 章节 append 行为废弃**:`appendSynthesisSection`(9 测)不再用;`SynthesisController.saveToNote` → 改 `saveSynthesisAsNote`(创建/更新综合笔记,新纯 seam + 测)。#07 的「存回笔记」语义从「追加章节」变「建/更节点」。
- **`(pN)` 页码跳转 affordance 在存为节点后暂缺**:#07 的 `decoratePageJumps` 只在 AI 面板消息渲染路径跑;综合笔记在 Obsidian 原生阅读视图打开时,`(pN)` 渲为纯文本(无跳转),`[[笔记]]` 双链仍可用。需后续版本尽快补:阅读视图 decorator(原生 markdown preview post-process,同 `decoratePageJumps` 逻辑挂 reading-view 渲染链)——记为近期货。
