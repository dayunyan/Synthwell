// src/i18n/index.ts — locale map + 系统语言检测 + t()。
// 纯逻辑、不 import obsidian(settings-tab.ts 注:obsidian 包 main:"" 为 types-only,
// 运行时 import 会让 node:test ERR_MODULE_NOT_FOUND)。本模块可被 node:test 加载单测,
// 亦可被 obsidian 耦合的 UI 模块安全 import。LLM prompt(buildSynthesisPrompt)**不**经此
// 模块——中英混合指令给模型,改语言影响质量(ADR-0003 / issue #06)。

/** 支持的语言。CJK-first 产品,至少 zh-CN + en。 */
export type Locale = "zh-CN" | "en";

/** 所有 user-facing 字符串(zh-CN + en)。每条两语言都必填——漏译编译期即报(satisfies)。 */
export const MESSAGES = {
  // ---- 命令名(main.ts)——命令面板可见 ----
  "cmd.openInShiyue": { "zh-CN": "拾阅: 在拾阅中打开 PDF", en: "Shiyue: Open PDF in Shiyue" },
  "cmd.extractBatch": { "zh-CN": "拾阅: 提炼全书要点(当前预览)", en: "Shiyue: Refine book highlights (current preview)" },
  "cmd.extractSelection": { "zh-CN": "拾阅: 提炼选中要点(当前预览)", en: "Shiyue: Refine selection (current preview)" },

  // ---- 设置面板(settings-tab.ts)----
  "settings.heading": { "zh-CN": "拾阅 / Shiyue", en: "拾阅 / Shiyue" },
  "settings.provider.name": { "zh-CN": "AI 服务商", en: "AI provider" },
  "settings.provider.desc": { "zh-CN": "DeepSeek(默认,高性价比)/ OpenAI 兼容", en: "DeepSeek (default, cost-effective) / OpenAI-compatible" },
  "settings.provider.optionOpenAI": { "zh-CN": "OpenAI 兼容", en: "OpenAI-compatible" },
  "settings.apiKey.name": { "zh-CN": "API Key", en: "API key" },
  "settings.apiKey.desc": { "zh-CN": "存于 Obsidian SecretStorage,加密、跨设备不同步", en: "Stored in Obsidian SecretStorage; encrypted, not synced across devices" },
  "settings.apiKey.placeholder": { "zh-CN": "sk-...", en: "sk-..." },
  "settings.model.name": { "zh-CN": "模型", en: "Model" },
  "settings.model.desc": { "zh-CN": "默认 deepseek-v4-flash(纯文本)", en: "Default deepseek-v4-flash (text-only)" },
  "settings.baseURL.name": { "zh-CN": "Base URL", en: "Base URL" },
  "settings.notesPath.name": { "zh-CN": "知识点笔记路径", en: "Knowledge-point notes path" },
  "settings.notesPath.desc": { "zh-CN": "知识点笔记存放目录(默认 拾阅笔记/知识点)", en: "Directory for knowledge-point notes (default: 拾阅笔记/知识点)" },
  "settings.synthesisPath.name": { "zh-CN": "综合笔记路径", en: "Synthesis notes path" },
  "settings.synthesisPath.desc": { "zh-CN": "综合笔记存放目录(默认 拾阅笔记/汇总)", en: "Directory for synthesis notes (default: 拾阅笔记/汇总)" },
  "settings.test.name": { "zh-CN": "连接测试", en: "Connection test" },
  "settings.test.desc": { "zh-CN": "发一次最小请求,验证 key/模型可用", en: "Send a minimal request to verify the key/model works" },
  "settings.test.button": { "zh-CN": "测试连接", en: "Test connection" },
  "settings.test.ok": { "zh-CN": "✓ 连接成功:{snippet}", en: "✓ Connected: {snippet}" },
  "settings.test.fail": { "zh-CN": "✗ 失败:{msg}", en: "✗ Failed: {msg}" },
  "settings.usage.name": { "zh-CN": "本月用量", en: "This month's usage" },
  "settings.usage.desc": { "zh-CN": "{input} 输入 / {output} 输出 tokens({month})", en: "{input} input / {output} output tokens ({month})" },

  // ---- AI 面板(ai-panel-view.ts)----
  "panel.displayText": { "zh-CN": "拾阅 AI 面板", en: "Shiyue AI Panel" },
  "panel.chatPlaceholder": { "zh-CN": "聊天 Agent(待实现)", en: "Chat Agent (coming soon)" },
  "panel.btn.batch": { "zh-CN": "提炼全书要点", en: "Refine book highlights" },
  "panel.btn.selection": { "zh-CN": "提炼选中要点", en: "Refine selection" },
  "panel.btn.synthesis": { "zh-CN": "汇总关联笔记", en: "Synthesize related notes" },
  "panel.btn.saveSynth": { "zh-CN": "存回笔记", en: "Save to note" },
  "panel.hint.disabled": { "zh-CN": "打开 PDF 或知识点笔记以启用", en: "Open a PDF or knowledge-point note to enable" },
  "panel.synth.loading": { "zh-CN": "汇总中", en: "Synthesizing" },
  "panel.synth.working": { "zh-CN": "综合关联笔记中…", en: "Synthesizing related notes…" },
  "panel.err.batch": { "zh-CN": "提炼失败:{msg}", en: "Refine failed: {msg}" },
  "panel.err.selection": { "zh-CN": "精读失败:{msg}", en: "Close-read failed: {msg}" },
  "panel.err.synthesis": { "zh-CN": "汇总失败:{msg}", en: "Synthesis failed: {msg}" },
  "panel.err.openLink": { "zh-CN": "打开失败:{msg}", en: "Open failed: {msg}" },
  "panel.err.linkNotFound": { "zh-CN": "找不到笔记:{link}", en: "Note not found: {link}" },

  // ---- 文件菜单(file-menu.ts)----
  "menu.openInShiyue": { "zh-CN": "在拾阅中打开", en: "Open in Shiyue" },

  // ---- 选区浮按钮(selection-capture.ts)----
  "float.deepRead": { "zh-CN": "精读选中", en: "Close-read selection" },

  // ---- loading notice(loading-notice.ts)----
  "loading.stop": { "zh-CN": "停止", en: "Stop" },

  // ---- 预估花费弹窗(confirm-modal.ts)----
  "confirm.title": { "zh-CN": "提炼要点 — 预估花费", en: "Refine highlights — estimated cost" },
  "confirm.body": { "zh-CN": "《{book}》:约 {chunks} 块 / {tokens} tokens,预计 ¥{cost}。继续?", en: "《{book}》: ~{chunks} chunks / {tokens} tokens, ~¥{cost}. Continue?" },
  "confirm.yes": { "zh-CN": "继续", en: "Continue" },
  "confirm.no": { "zh-CN": "取消", en: "Cancel" },

  // ---- 工作区提示(shiyue-workspace.ts)----
  "notice.noPdf": { "zh-CN": "没有打开的 PDF", en: "No PDF open" },
  "notice.selectText": { "zh-CN": "请先在 PDF 中选中一段文字", en: "Select a passage in the PDF first" },
  "notice.cantCreatePreview": { "zh-CN": "无法创建预览面板", en: "Could not create preview panel" },
  "notice.noPdfInVault": { "zh-CN": "vault 中没有 .pdf 文件", en: "No .pdf files in the vault" },

  // ---- 存回笔记 + 页码跳转(#07)----
  "notice.synthSaved": { "zh-CN": "✓ 已存为综合笔记", en: "✓ Saved as synthesis note" },
  "notice.synthSaveFail": { "zh-CN": "✗ 存回失败:{msg}", en: "✗ Save failed: {msg}" },
  "synth.overwrite.title": { "zh-CN": "覆盖综合笔记?", en: "Overwrite synthesis note?" },
  "synth.overwrite.body": { "zh-CN": "已存在综合笔记,重新汇总将覆盖现有内容。继续?", en: "A synthesis note already exists. Re-synthesizing will overwrite it. Continue?" },
  "synth.overwrite.continue": { "zh-CN": "继续", en: "Continue" },
  "synth.overwrite.cancel": { "zh-CN": "取消", en: "Cancel" },
  "notice.sourcePdfNotFound": { "zh-CN": "找不到源 PDF:{pdf}", en: "Source PDF not found: {pdf}" },
  "notice.pageJumpUnavailable": { "zh-CN": "页码跳转暂不可用,已打开第 1 页", en: "Page navigation unavailable; opened page 1" },
  "picker.title": { "zh-CN": "选择要在拾阅中打开的 PDF", en: "Choose a PDF to open in Shiyue" },
  "picker.placeholder": { "zh-CN": "搜索文件名…", en: "Search by filename…" },

  // ---- 抽取控制器(extraction-controller.ts / synthesis-controller.ts)----
  "notice.noApiKey": { "zh-CN": "未配置 API Key,请在设置中添加", en: "API key not configured; add it in Settings" },
  "extract.batchLabel": { "zh-CN": "提炼中", en: "Refining" },
  "extract.selectionLabel": { "zh-CN": "精读中", en: "Close-reading" },
  "extract.pdfNotLoaded": { "zh-CN": "PDF 未加载完成", en: "PDF not finished loading" },
  "extract.cancelled": { "zh-CN": "已取消", en: "Cancelled" },
  "extract.success": { "zh-CN": "✓ {message}:{count} 个知识点(见 {notesPath}/)", en: "✓ {message}: {count} knowledge points (see {notesPath}/)" },
  "extract.fail": { "zh-CN": "✗ {message}", en: "✗ {message}" },
  "extract.noResult": { "zh-CN": "未能抽取(模型未返回有效结果)", en: "Could not refine (model returned no valid result)" },
  "extract.generated": { "zh-CN": "✓ 已生成:{title}", en: "✓ Generated: {title}" },
  "extract.selectionFail": { "zh-CN": "精读失败:{msg}", en: "Close-read failed: {msg}" },
  "extract.progress": { "zh-CN": "{done}/{total} → {points} 点", en: "{done}/{total} → {points} points" },

  // ---- honest-sparse 综合视图(synthesizer.ts buildSparseMarkdown;渲染给用户,非 prompt)----
  "synth.sparse.heading": { "zh-CN": "# 汇总:{title}", en: "# Synthesis: {title}" },
  "synth.sparse.warning": { "zh-CN": "> ⚠️ 关联较少。目前这个知识点的关联笔记不足,无法跨文档综合。随着你抽取更多文档,汇总将跨文档综合关联知识点。", en: "> ⚠️ Few related notes. This knowledge point has too few associated notes to synthesize across documents. As you refine more documents, synthesis will integrate related knowledge points." },
  "synth.sparse.currentHeading": { "zh-CN": "## 当前知识点", en: "## Current knowledge point" },
  "synth.sparse.currentLine": { "zh-CN": "**{title}**(《{pdf}》p{page})", en: "**{title}** (《{pdf}》 p{page})" },
  "synth.sparse.excerpt": { "zh-CN": "> 原文片段:{text}", en: "> Source excerpt: {text}" },
  "synth.sparse.relatedHeading": { "zh-CN": "## 关联笔记", en: "## Related notes" },
} satisfies Record<string, { "zh-CN": string; en: string }>;

export type MessageKey = keyof typeof MESSAGES;

/** 当前语言(模块级缓存)。默认 zh-CN(CJK-first);plugin.onload 调 setLocale(detectLocale())。 */
let current: Locale = "zh-CN";

export function setLocale(l: Locale): void { current = l; }
export function getLocale(): Locale { return current; }

/** 检测用环境(可注入单测)。window.moment?.locale() 优先(Obsidian 语言设置),次 navigator.language。 */
export interface DetectEnv {
  momentLocale?: () => string | undefined;
  navigatorLanguage?: () => string | undefined;
}

/** 运行时环境探测。node:test 下 window/navigator 均无 → 两者 undefined。 */
function browserEnv(): DetectEnv {
  const w = (typeof window !== "undefined" ? (window as { moment?: { locale(): string } }) : undefined);
  return {
    momentLocale: w?.moment ? () => w.moment!.locale() : undefined,
    navigatorLanguage: typeof navigator !== "undefined" ? () => navigator.language : undefined,
  };
}

/** 检测系统语言:zh* → zh-CN;en* → en;检测到但不支持(如 fr)→ en 回退;无信号 → zh-CN 默认。
 *  issue #06:用 window.moment?.locale() / navigator.language。大小写不敏感。 */
export function detectLocale(env: DetectEnv = browserEnv()): Locale {
  const sig = env.momentLocale?.() ?? env.navigatorLanguage?.() ?? "";
  const low = sig.toLowerCase();
  if (low.startsWith("zh")) return "zh-CN";
  if (low.startsWith("en")) return "en";
  if (sig) return "en";          // 检测到、不支持 → English 回退
  return "zh-CN";                // 无信号 → CJK-first 默认
}

/** 取本地化字符串。占位符 {name} 用 params 替换。缺失 key → 回退 key 字符串(便于发现漏译)。 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key];
  let s: string;
  if (!entry) { s = key as string; }
  else { s = entry[current] ?? entry["zh-CN"]; }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}
