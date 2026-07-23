# 拾阅 / Shiyue 产品设计文档(桌面验证版 v0.1.0)

> **产品名**:拾阅 / Shiyue(插件 ID `shiyue`)
> **版本**:v0.1.0(版本号自本设计起重置)
> **日期**:2026-07-23
> **状态**:桌面级可行性验证 + 设计完成;待 W0 spike 做 Go/No-Go 决策
> **作者**:开发者本人(经 Claude Code 头脑风暴 + 5 路并行研究验证)
> **前置文档**:《Synthwell(合阅)产品文档 V1.0》《Synthwell(合阅)V1.5(假设清单草案)》
> **与前置文档关系**:本设计**不替代** V1.5 的反规划哲学,而是补上 V1.5 推迟的「桌面级验证」——把关键可行性论断从「假设」升级为「有证据的判断」,并据此重写定位与设计。所有结论仍标注证据来源与可信度。

---

## 0. TL;DR — 能不能做

| 维度 | 判断 | 一句话依据 |
|---|---|---|
| 技术可行(PDF/API/CJK/向量) | ✅ 能做,无 showstopper | 5 路研究证实:无硬天花板、API 全 documented、CJK 可解、本地向量有先例(但 vectra 分片前提是错的) |
| 按 V1.5 商业模式(MIT/无后端/¥68-88 买断/¥1.5-4 万) | ❌ 不能 | 该**具体组合**在 Obsidian 零成功先例;现实区间 ¥3-10k/年 |
| 作为学习/手艺/社区项目 | ✅ 值得 | 押唯一站得住的差异化三角:CJK-first + 微信读书原生 + 100% 本地 |
| 差异化窗口 | ⚠️ 真实但收窄,6-12 月 | Copilot 已吃 PDF 付费版;Rabbitor + 4 微插件在收敛;要快 |
| 许可证 | AGPL-3.0 + 官方市场;v2 后端做订阅(不 relicense) | 绕开 V1.5 Q76「MIT→BSL 不可逆」陷阱 |

**核心结论不是「做不做」,而是「按什么模式做」**:技术能做、按现状商业模式不能 → 重定位为学习/手艺项目(AGPL 开源核心 + v2 保留后端订阅期权),押注 CJK+微信读书+本地三角,W0 spike 闸门确认实现正确性 + 市场验证。

---

## 1. 方法论说明(诚实标注)

本设计与 V1.5 的关键区别:**V1.5 是「假设生成工具」(5-Agent 红蓝对抗,样本量=0);本设计在 V1.5 基础上补了「桌面级实证验证」**——用 5 路并行 Web 研究(详见附录 A)逐条压力测试 V1.5 的关键论断,把「假设」升级为「有证据的判断」。

但本设计**仍不是市场验证**:
- ✅ 技术可行性论断:已用上游 issue、官方文档、现有插件实证检验,可信度中-高
- ❌ 用户需求/付费意愿:仍未接触真实用户,可信度低
- ⚠️ 因此 W0 spike 仍需 **≥2 位真实 Obsidian 用户**评分,作为市场验证闸门(沿用 V1.5 Q71)

本设计保留 V1.5 的两条纪律:
1. **论证成瘾警告**:spike 结果出来即决策,不允许以「需要更多信息」继续论证
2. **灰色=No-Go**:spike 结果不明确默认终止

---

## 2. 章节 A:定位

**一句话定位**:拾阅是 Obsidian 上 **CJK-first(中文优先)的本地 PDF 阅读高亮 + AI 理解 + 微信读书原生导入** 插件,让中文功利性阅读的笔记自动生长为可检索、可关联的知识网络。

**押注的唯一差异化三角**(研究证实还站得住):
1. **CJK-first**:中文 PDF 排版/选区/分词专项;微信读书(中国-first 平台)原生打通——现有 AI 插件(Copilot/Smart Connections)皆英文优先,这是真空白
2. **100% 本地**:笔记/高亮/向量全本地 Markdown/JSON——对 NotebookLM(全云)、Copilot 付费版(云端提取 PDF)、Readwise(云 SaaS)的差异化
3. **PDF 内高亮 + AI 闭环**:目前无成熟插件把「PDF 内高亮」和「AI」合一(Copilot 只把 PDF 当 AI 上下文、无阅读/标注 UI)

**首要 KPI**(从「收入」改为):学到 + 做出来 + 有人用。收入当 bonus,现实预期 ¥3-10k/年。

**明确不宣传**:「Obsidian 深度集成」(入门票非护城河)、「比 NotebookLM 聪明」(依赖上游模型)、「功能最全」(60 分陷阱)、「免费替代 Readwise」(价格战不可持续)。

> **来源**:差异化判断来自竞品研究(附录 A.3);「Obsidian 集成是入门票」来自 Copilot 1.5M 下载 + Smart Connections 1.1M 的实证;CJK 空白来自现有 AI 插件皆英文优先。

---

## 3. 章节 B:许可证与分发

### 技术现实(决策前提)
Obsidian 插件是**客户端 JS bundle**,装进用户 vault(`.obsidian/plugins/<id>/main.js`)后**任何人可读**。对纯客户端、无后端插件,「关键代码不开源」是名义闭源、实际可读。且**官方社区市场要求提交时源码可被审核**——「吸引人来用」(需市场触达)与「关键代码不开源」在纯客户端组合下做不到。

### 决策:AGPL-3.0 + 官方市场;订阅层用 v2 后端实现,不靠 relicense

| 决策 | 内容 | 依据 |
|---|---|---|
| 许可证 | AGPL-3.0 | Obsidian 成功插件事实标准(Copilot/Smart Connections/Templater/Excalidraw 皆 AGPL);比 MIT 更防 fork,满足「不送农场」直觉 |
| 分发 | 官方社区市场为主 | 触达主力(Annotator 585k、Copilot 1.5M 下载皆在此);BRAT/手动安装触达很小 |
| 订阅层(v2) | 新增**后端服务**(全新闭源代码)+ 付费 API,前端插件继续 AGPL 免费升级 | 绕开 V1.5 Q76「MIT→BSL 不可逆」——不 relicense,而是加新闭源代码 |
| 闭源价值 | RAG 策略/AI 编排等「值得保护的东西」放 v2 后端,不放进客户端 | 客户端闭源无意义;Obsidian 无纯客户端闭源赚钱先例 |

**与用户初始诉求的调和**:用户希望「关键代码不开源,先做产品吸引用户,后期加订阅层」。本决策**更优地满足该诉求**:AGPL 防恶意 fork(比 MIT 强)、官方市场拿触达(满足「吸引用户」)、v2 后端做订阅(满足「后期加订阅层」),且避开了纯客户端闭源的不可能 + relicense 的不可逆。

> **来源**:Glean.com 冲突排查(附录 A.6);Obsidian 成功插件许可证实证(附录 A.3/A.4);V1.5 Q76 BSL 不可逆论证。

---

## 4. 章节 C:MVP 功能范围(P0,研究修正版)

P0 共 6 项 + CJK 专项。每项按研究修正。存储目录 `.shiyue/`。

| # | 功能 | V1.5 原版 | 研究修正 |
|---|---|---|---|
| F1 | PDF 阅读器 | pdfjs+虚拟滚动,200页<3s | 加两条硬验收:① Worker 在 `app://` origin 下真起子线程(无 "Setting up fake worker");② 关视图后内存回基线(Annotator #233 翻车点) |
| F2 | 高亮+笔记 | 坐标归一化,CJK<10px | **改文本锚定(prefix/exact/postfix)为主**(学 Annotator/Hypothesis),绕开 CJK 偏移整类;坐标+手动微调作 OCR/竖排实验性退路;删无依据的 <10px 标准 |
| F3 | AI 对话面板 | 段落助教,SSE,MarkdownRenderer | 用 `MarkdownRenderer.render()`(非 deprecated 的 `renderMarkdown()`);管理 Component 生命周期(替换消息时 `unload()`,否则后处理器/hover 泄漏) |
| F4 | Settings+API Key | safeStorage+明文 fallback | **改 `app.secretStorage`(SecretStorage/SecretComponent,`@since 1.11.4`)**,跨平台 per-vault;删明文 fallback |
| F5 | 微信读书/Kindle 导入 | 宽松正则解析 HTML | **改官方 Agent API + API Key 路径**(`obsidian-weread-plugin`/`weread2notion` 已如此),不爬 HTML;Kindle `My Clippings.txt` 仍解析;真实风险标注为封号/Cookie失效/Electron CORS |
| F6 | schema v1 | frontmatter+高亮JSON+进度 | 不变,`schemaVersion:1`,与 W0 并行 |

**P0 新增 CJK 专项**(对应护城河,不大但做):CJK 分词的文档内搜索、中文 PDF 排版(标点挤压/竖排标注实验性)、微信读书中国-first 原生打通。

**P1(研究修正)**:
- F7 EPUB(不变,复用 `IDocumentRenderer`)
- F8 向量语义检索——**重写策略**:不依赖 vectra 的「分片+懒加载」(vectra #57:它把整个被查索引载入内存,无分片/懒加载 API)。改为**自建编排:每书一索引 + 按需加载 + 查后卸载**,或评估**磁盘后端(SQLite/二进制流式,见 Copilot #2325 报告者建议)**;低维 256/512 真能省(`OpenAIEmbeddings.dimensions`);跨书检索与「常驻<50MB」天然冲突,spike 实测。

**P2/v2**:被动式复习、纸质书 OCR、阅读统计、**后端订阅层**(条件触发)。

---

## 5. 章节 D:技术架构与关键修正

架构骨架沿用 V1.5 模块图(DocumentRenderer / HighlightManager / NoteGenerator / LLMService / ContextManager / ImportEngine / VectorIndex),存储目录 `.shiyue/`。8 处关键修正:

| # | 修正点 | 来源 | 优先级 |
|---|---|---|---|
| D1 | Worker 优先静态文件 `pdf.worker.min.mjs` 或模块 worker `new Worker(new URL(...))`+`workerPort`;blob-URL 易静默回退 fake worker;`disableWorker` 兜底 | pdfjs #20316/#20445/#20236 | P0 闸门 |
| D2 | 内存清理滴水不漏:`RenderTask.cancel()` + 置空 canvas ref + `page.cleanup()` + `PDFDocumentProxy.cleanup()`,滚动移出和关视图都调 | Annotator #233 反面教材 | P0 |
| D3 | 锁定 pdfjs-dist 版本;v5.x worker+bundler 补丁版间会崩;升级=重测 | pdfjs #20236 | P0 |
| D4 | 写入串行化:插件写操作串行,不与编辑器自动保存抢(Vault.modify/process 重叠→`file.saving` 永久 true→静默丢数据);用 `registerEvent` 自动卸载 | 论坛维护者 Licat 确认 bug | P0 |
| D5 | API Key 用 `app.secretStorage`,非 safeStorage+明文 | `@since 1.11.4` 文档 | P0 |
| D6 | `MarkdownRenderer.render()` + Component 生命周期管理 | obsidian.d.ts #4137 | P0 |
| D7 | 向量层不假设 vectra 分片:自建每书索引+懒加载+查后卸载,或换磁盘后端;8GB spike 实测 | Copilot #2325、vectra #57 | P1 |
| D8 | 移动端 `isDesktopOnly:true`,理由改为「无 Electron/Node + 整文件 binary OOM」,非「WKWebView Canvas 限制」 | 移动端开发文档 | P0 |

**Obsidian API 使用**:全部 documented 稳定 API(registerView/addSettingTab/addCommand/vault.adapter/Vault.process/MarkdownRenderer.render/getLeaf/SecretStorage),不注册 `['pdf']` 扩展名(命令面板入口),不依赖任何 undocumented API。研究证实可搭出 MVP。

**数据层**:`.shiyue/highlights/*.json` + `.shiyue/vectors/`(P1)+ `.shiyue/stats.json`;用户可见笔记 `拾阅笔记/`;CJK 高亮用文本锚定存储。

---

## 6. 章节 E:W0 spike(Go/No-Go 闸门)

研究把 PDF 可行性从「未知」变「基本已答」,spike 职责收窄为**确认实现正确性 + 市场验证**。

| 验证项 | 通过判据 | 研究修正 |
|---|---|---|
| E1 Worker 真起子线程 | Obsidian ItemView 里无 "Setting up fake worker" 警告 | **头号闸门**(blob-URL 易静默回退主线程) |
| E2 大 PDF 不崩 | 200页<3s 打开;800页滚动不崩;IO 驱动 ±2 页 + Canvas 销毁 | 可达(无硬天花板) |
| E3 内存能回收 | 关视图后内存回基线 | **新增闸门**(Annotator #233 翻车) |
| E4 CJK 高亮 | 钉定 ≥#20334 修复版 pdfjs-dist;横向 Word/WPS/LaTeX 选区实测;定文本锚定方案 | 大部分已答,spike 确认 |
| E5 学曲线 | ≤5 天搭骨架(registerView/SettingTab/命令/文件IO) | **对本用户真实变量**(前端熟但没碰过 Obsidian API) |
| E6 真实用户评分 | ≥2 位非社交圈 Obsidian 用户对 PDF 体验 ≥3.5/5 | 招人是难点(V1.5 Q71) |
| E7 时间约束可执行 | spike 期间不破时间预算 | burnout 预测器 |

**Go**:E1-E5 全过 + E6 达标 + E7 可执行。
**Conditional-Go**:仅 E1 或 E3 勉强可用但有明确技术路径 → ≤2 周针对性修,仍不过则 No-Go。
**No-Go**:E1 无可用缓解 / E3 内存无法回收 / 招不到 ≥2 真实用户 / E5 >7 天 / 论证成瘾复发想「再试一次」。

保留 V1.5 纪律:**无 Plan B、无二次 spike、灰色=No-Go**。No-Go 触发面比 V1.5 窄且更诚实(研究已证伪「PDF 有硬天花板」)。

**用户招募渠道**:Obsidian 中文社区(论坛/群)、Reddit r/ObsidianMD;筛选标准:用 Obsidian 6 月以上、有电脑端读 PDF 习惯、愿花 30-60 分钟测并提供书面反馈。

---

## 7. 章节 F:阶段计划(spike 闸门,诚实区间)

不写 W1-W10 假精确表(尊重 V1.5 + 方案 1)。给阶段、里程碑、区间、依赖。

| 阶段 | 内容 | 区间(15h/周) | 依赖/闸门 |
|---|---|---|---|
| P0 spike | E1-E7 | ~1 周 | **Go/No-Go 闸门** |
| P1 MVP | 6 项 P0 + CJK 专项。顺序:脚手架→PDF核心(worker+虚拟滚动+清理)→高亮(文本锚定)→AI面板→Settings/SecretStorage→导入(官方WeRead API)→schema→打磨/测试/市场提交 | ~10-14 周(无同类严格基准) | spike Go |
| P1.5 提交 | Obsidian 社区审核 | 审核周期 1-3 周(外部不可控) | MVP 完成 |
| P2 增强 | EPUB + 向量语义检索(自建分片编排或磁盘后端) | ~4-6 周 | MVP 有初步装机 |
| P3 v2(条件) | 后端订阅层(若验证到付费意愿) | 待定 | P2 后观察到 traction |

**降级预案**:
- PDF 模块延误>3 天 → 砍 AI 多轮只做单轮
- 导入模块延误 → 推 v0.2,先发 PDF+AI 核心
- 整体落后>1 周 → 砍暗色/目录面板等体验项,保核心流程

---

## 8. 章节 G:成功指标 / kill 线(诚实版)

删伪精确(V1.5 的「Stars≥200、安装≥500」等无依据)。

- **学习 KPI**(主):spike ≤7 天;v0.1 上架市场;掌握 Obsidian/Electron/AI 集成手艺
- **使用 KPI**(90 天,观察非目标):装机量、周活——给区间不给假目标;具体成功线发布后据真实分布定
- **kill/转维护线**:90 天后若装机/周活长期低迷 → ≤5h/月只修 bug;保留「论证成瘾→No-Go」纪律
- **收入**:bonus,现实 ¥3-10k/年(赞助/爱发电),无目标;v2 后端是「观察到付费意愿后」的可选变现

---

## 9. 章节 H:风险(研究更新)

| # | 风险 | 研究更新 | 应对 |
|---|---|---|---|
| T1 | PDF 内存 | CONFIRMED | 滴水不漏清理(D2) |
| T2 | Worker | CONFIRMED 为头号闸门 | 静态/模块 worker + disableWorker 兜底(D1) |
| T3 | .pdf 扩展冲突 | 确认 | 不注册,命令面板入口 |
| T4 | CJK | DE-RISKED | 文本锚定绕开偏移类(D1/F2) |
| T5 | AI 上下文 | 不变 | 段落助教,不承诺全书 |
| T6 | API breaking | 低 | 只用 documented,best-effort |
| M1 | API Key 流失 | 真 | SecretStorage 改善 UX;核心无 Key 可用 |
| M2 | PDF 体验 | DE-RISKED | 无硬天花板;Annotator 失败可避 |
| M3 | 市场天花板 | 确认 | 小而美,全球化并行 |
| M4 | 留存 | 真 | 导入解决冷启动 |
| C1 | NotebookLM 压付费意愿 | 确认 | 不赌收入(方案 1) |
| C2 | Obsidian 官方做 | 低 | 做深度(跨书/WeRead)非广度 |
| C3 | fork | 中 | AGPL + v2 后端 |
| C4 | Readwise 加深集成 | 中 | 本地+免费核心错位 |
| O1 | burnout | 高 | 15h/周目标上限(自约束) |
| O2 | API Key 泄露 | 低 | SecretStorage |
| O3 | 买断不可持续 | — | 本设计不靠买断;v2 后端订阅 |
| O4 | WeRead 维护 | 重定义 | 官方 API,风险=封号/Cookie/CORS 非 DOM |
| **新** | Copilot 吞噬 | 6-12 月窗口 | 押 CJK+微信读书+本地三角;快出可用版 |
| **新** | 变现零先例 | 确认 | 方案 1 接受;v2 后端保留期权 |

---

## 附录 A:桌面研究证据摘要(5 路并行,2026-07-23)

### A.1 PDF.js 在 Obsidian(可信度:中-高)
- **无硬天花板**:200页<3s「很容易」(打开时间≈解析+首页绘制,与页数无关);800页不崩「可达」(虚拟滚动+Canvas销毁+cleanup)。pdfjs #13112、#11297。
- **Annotator 反面教材**:500MB PDF→5GB 不释放(#233)、CPU 占满(#315)、冻结(#181),自 2024-01 停更;不做虚拟滚动。**降低**本设计风险——失败正是设计要避开的,且无人把虚拟滚动版搬进 Obsidian。
- **头号闸门=Worker**:blob-URL worker 易在 Obsidian `app://` origin/CSP 下静默回退「fake worker」(主线程),看起来能用但滚动卡死。pdfjs #20316、#20445、#20236。缓解:静态文件 workerSrc / 模块 worker + `workerPort` / `disableWorker` 兜底。
- **虚拟滚动+IO+销毁**:是 pdf.js 官方 viewer 自己的策略(`base_viewer.js`),非创新/高风险。
- **结论**:无 showstopper。前端熟(无 Obsidian 经验)开发者 2 天 spike + 3 周可达成核心阅读器;高亮打磨/边角 PDF 会超支。

### A.2 Obsidian API(可信度:高)
- 全 documented 稳定:registerView/addSettingTab/addCommand/getLeaf;vault.adapter(原始 binary CRUD 用)/Vault.process(常规读改写优先);registerEvent 自动卸载。
- ⚠️ `MarkdownRenderer.render()`(非 deprecated `renderMarkdown()`);Component 生命周期必管。
- ⚠️ `app.secretStorage`(SecretStorage/SecretComponent,`@since 1.11.4`)替代 safeStorage;删明文 fallback。
- ⚠️ 已确认 bug(维护者 Licat):Vault.modify/process 重叠→`file.saving` 永久 true→静默丢数据。需串行化写入。
- `registerExtensions(['pdf'])` 不注册(会全局覆盖默认查看器+冲突)。V1.5 决策正确。
- 移动端:理由应改为「无 Electron/Node + 整文件 binary OOM」(`adapter.readBinary` 整文件载入),非「WKWebView Canvas 限制」。设 `isDesktopOnly:true`。
- 证据:obsidian.d.ts、obsidian-developer-docs(Views.md/Workspace.md/Vault.md/Events.md/Mobile.md/Store secrets.md)。

### A.3 竞品(可信度:中-高)
- **无成熟插件把「PDF 内高亮 + AI」合一**(今天成立,半衰期 6-12 月)。Copilot 已吃 PDF(付费/云端/仅上下文);Rabbitor(v0.1,2026-04)+ 4 微插件在收敛。
- ⚠️ **Annotator 真实下载 585k**(V1.5 说 8 万+严重低估);停更(2024-01);无 AI。
- **Copilot = 1.5M 下载、积极维护、已吃 PDF/EPUB**(付费/云端提取/非阅读器)。最大威胁。
- **Smart Connections 1.1M**,本地嵌入默认免费,语义搜索只索引 Markdown(无原生 PDF)。
- ⚠️ **三个差异化两个被侵蚀**:「Obsidian 集成」=入门票;「100% 本地」=正变基线。**唯一站得住=CJK+微信读书原生**。
- ⚠️ **微信读书「HTML 每 3-6 月变」论断过时**:维护中工具(`obsidian-weread-plugin` 2.2k★、`weread2notion` 2.9k★)已用官方 Agent API + API Key,不爬 HTML。真实风险=封号/Cookie/CORS。

### A.4 市场/变现(可信度:中,但方向硬)
- ⚠️ **V1.5「无付费插件先例」已过时**:Copilot($14.99/月 或 $139.99/年;+$349.99 自托管)和 Smart Connections Pro($30/月)是付费成功案例。**但两者皆用「后端+订阅」——恰好是 V1.5 拒绝的模式**。纯 MIT+无后端+一次性买断:**零已知成功**。
- 算术现实:¥4 万(≈$5,600)按 ¥88 买断需 ~460 付费用户,按 1-3% 转化需 1.5-4.6 万月活——不知名单人新插件,杆极高。**¥4 万幻想,¥1.5 万需冲 top-0.1% 星标**,现实 ¥3-10k/年。
- Obsidian 用户数:官方不披露 MAU;下载衍生估计 1-3M(V1.5 的 2-3M 偏乐观)。中国占比 10-15% 无依据。插件安装→月活转化 5-15% 无 Obsidian 基础。
- 免费 NotebookLM 压制「只读 PDF+AI」付费意愿。
- 证据:obsidian.md/pricing、community-plugins.json(5,971 插件)、obsidiancopilot.com/en/pricing、smartconnections.app/pro-plugins。

### A.5 CJK + 向量(可信度:中-高)
- **CJK 偏移真实但可解,非架构问题**:pdfjs #20319(2025-09 已修,横向 Type0 字体 word-spacing 错套 CJK)是最大类;#6509(OCR,9 年未修)、#20017(宽度错配,未修)是长尾。V1.5 删 <10px 标准正确(无上游依据)。**文本锚定(prefix/exact/postfix,学 Annotator/Hypothesis)绕开坐标偏移整类**。OCR/竖排「实验性+手动微调」合理退路。
- **向量在 8GB 可行但有坑,且 V1.5 缓解前提错**:Copilot #2325 直接先例——7700 笔记→2.2GB→V8 膨胀→撞 Electron ~4GB 堆顶→语义搜索死。**vectra 把整个被查索引载入内存,无分片/懒加载 API**(#57)。低维 256/512 真能省(`OpenAIEmbeddings.dimensions`)。分片/懒加载需自建(每书一索引+按需加载+查后卸载),跨书检索与「常驻<50MB」天然冲突。或换磁盘后端(SQLite/二进制流式)。
- 证据:pdfjs #20319/#6863/#20017/#17493/#6509;obsidian-annotator #327;obsidian-copilot #2325/#1852;smart-connections #1007/#120/#336;vectra(api-reference、#57/#3/#58)。

### A.6 名称冲突排查(可信度:高)
- Obsidian 注册表无 "glean" → 插件 ID `glean` 可用(后改 `shiyue`)。
- GitHub `obsidian-glean` 被 `jhofker` 占(0 星占位)——不影响,用其他 repo 名。
- ⚠️ 英文 "Glean" 与 **Glean Technologies(glean.com)**冲突——融资雄厚的企业 AI 搜索公司(2019 创立,客户含 Booking/Samsung/Reddit)。AI 知识产品用 "Glean" 商标/混淆风险真。故国际名改 **Shiyue**(拼音,零冲突,CJK-first 地道)。

---

## 附录 B:V1.5 → 本设计 修正对照表

| # | V1.5 论断 | 本设计修正 | 来源 |
|---|---|---|---|
| 1 | PDF 有体验天花板(Q8),spike 发现能否跑 | 已证伪硬天花板;spike 改为确认实现正确性(Worker/内存回收) | A.1 |
| 2 | safeStorage+明文 fallback 存 API Key | 改 `app.secretStorage`,删明文 fallback | A.2 |
| 3 | CJK 偏差<10px(后删,待实测) | 文本锚定为主,绕开偏移整类;删<10px | A.5 |
| 4 | 微信读书 HTML 每 3-6 月变,要重写解析器 | 改官方 Agent API + API Key;风险重定义为封号/Cookie/CORS | A.3 |
| 5 | 向量靠 vectra 分片+懒加载+低维达 <50MB | vectra 无分片/懒加载 API;需自建编排或换磁盘后端 | A.5 |
| 6 | 移动端不做因「iOS WKWebView Canvas 内存限制」 | 理由改为「无 Electron/Node + binary OOM」;`isDesktopOnly:true` | A.2 |
| 7 | Annotator 8 万+安装(间接证据) | 真实 585k(严重低估) | A.3 |
| 8 | 无付费插件先例 | 已过时(Copilot/Smart Connections Pro);但成功模式=后端+订阅 | A.4 |
| 9 | MIT 许可证(D14 待定) | AGPL-3.0(v2 后端做订阅,不 relicense) | A.3/A.4 |
| 10 | 收入 ¥1.5-4 万/年 | 现实 ¥3-10k/年;收入降为 bonus | A.4 |
| 11 | 三个差异化(集成/本地/CJK) | 集成=入门票、本地=正变基线;押 CJK+微信读书+本地三角 | A.3 |
| 12 | 5-Agent 是假设生成(承认局限) | 补桌面实证验证(5 路 Web 研究);仍非市场验证,spike 补 | 方法论 |

---

## 附录 C:待决策项(spike/数据触发)

| # | 待决策 | 触发时机 |
|---|---|---|
| D1 | 是否注册 `.pdf` 扩展名 | spike 后用户测试(倾向不注册) |
| D2 | 向量层:vectra 自建编排 vs 磁盘后端 | P2 前实测 |
| D3 | v2 后端是否启动 | MVP 后观察到付费意愿 |
| D4 | 全球化 vs 中文优先 | MVP 后中国/海外用户比 |
| D5 | 成功/kill 具体数值线 | 发布后据真实分布定 |

---

## 附录 D:文档变更日志

| 版本 | 日期 | 主要变更 | 来源 |
|---|---|---|---|
| V0.1(V1.0 终版) | 2026-07-22 | 5-Agent + 红蓝对抗 V1 终版 | 红方 31 条 |
| V1.5(草案) | 2026-07-22 | 重构为假设清单;删已验证标签/W1-W10 路线图/Plan B | 红方 V3 22 条 |
| **本设计** | **2026-07-23** | **桌面级验证 + 定位重写(CJK-first 三角)+ AGPL/v2 + 8 条架构修正 + spike 闸门收窄** | **5 路并行 Web 研究** |

---

*下一步唯一动作:执行 W0 spike(章节 E),按 Go/No-Go/Conditional-Go 决策。不再论证。*
