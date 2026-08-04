---
status: accepted
---

# 拾阅 / Shiyue 为唯一规范名;弃 Synthwell

产品名规范为「拾阅 / Shiyue」。仓库名 `Synthwell` 仅为历史目录名,不再作产品/代码/数据标识。frontmatter 标识键从 `synthwell_type` 改为 `shiyue_type`。

原 spec 因「Synthwell / Glean」与 Glean Technologies(glean.com,企业 AI 搜索)冲突而改国际名 Shiyue(拼音、零冲突、契合 CJK-first 定位)。内部代号 `synthwell_type` 是改名前遗留,贯穿数据 schema——发布后改它需迁移用户已生成的笔记。趁尚未发布、零存量笔记时统一为 `shiyue_type`。

保留仓库名 `Synthwell` 不改(git 目录重命名无收益,且内部开发已习惯)。
