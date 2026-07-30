// src/settings-tab.ts — 拾阅设置面板(plan1 task7)。
// 单独成文而非追加到 settings.ts:settings.ts 是纯数据形状(Task 1 单测在
// `node --test --experimental-strip-types` 下跑),若在此 import "obsidian"
// 会让 Node 尝试解析 types-only 的 obsidian 包(main:"")而 ERR_MODULE_NOT_FOUND,
// 连带 settings.test.ts 失败。UI 与 obsidian 耦合,无单测,人工验。
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { OpenAICompatibleProvider } from "./core/llm/llm-service";
import { UsageTracker } from "./core/llm/usage";
import { t } from "./i18n";
import type { ShiyueSettings } from "./settings";

/** SecretStorage key id(小写字母+连字符,符合 SecretStorage 约定)。 */
const SHIYUE_API_KEY_ID = "shiyue-api-key";

export class ShiyueSettingTab extends PluginSettingTab {
  private plugin: { settings: ShiyueSettings; saveSettings(): Promise<void>; };
  private usage: UsageTracker;
  constructor(app: App, plugin: { settings: ShiyueSettings; saveSettings(): Promise<void>; }, usage: UsageTracker) {
    super(app, plugin as any);
    this.plugin = plugin;
    this.usage = usage;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("settings.heading") });

    new Setting(containerEl).setName(t("settings.provider.name")).setDesc(t("settings.provider.desc")).addDropdown(d => d
      .addOption("deepseek", "DeepSeek").addOption("openai-compatible", t("settings.provider.optionOpenAI"))
      .setValue(this.plugin.settings.provider)
      .onChange(async v => { this.plugin.settings.provider = v as any; if (v === "deepseek") { this.plugin.settings.baseURL = "https://api.deepseek.com"; this.plugin.settings.model = "deepseek-v4-flash"; } await this.plugin.saveSettings(); this.display(); }));

    new Setting(containerEl).setName(t("settings.apiKey.name")).setDesc(t("settings.apiKey.desc")).addText(tc => {
      tc.inputEl.type = "password"; tc.setPlaceholder(t("settings.apiKey.placeholder"));
      // 回填:从 secretStorage 读现有 key(SecretStorage @since 1.11.4,getSecret 同步)
      const existing = this.app.secretStorage.getSecret(SHIYUE_API_KEY_ID);
      if (existing) tc.setValue(existing);
      tc.onChange(async v => { this.app.secretStorage.setSecret(SHIYUE_API_KEY_ID, v.trim()); });
    });

    new Setting(containerEl).setName(t("settings.model.name")).setDesc(t("settings.model.desc")).addText(tc => tc.setValue(this.plugin.settings.model).onChange(async v => { this.plugin.settings.model = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName(t("settings.baseURL.name")).addText(tc => tc.setValue(this.plugin.settings.baseURL).onChange(async v => { this.plugin.settings.baseURL = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName(t("settings.test.name")).setDesc(t("settings.test.desc")).addButton(b => b.setButtonText(t("settings.test.button")).onClick(async () => {
      try {
        const key = this.app.secretStorage.getSecret(SHIYUE_API_KEY_ID);
        const p = new OpenAICompatibleProvider({ baseURL: this.plugin.settings.baseURL, apiKey: key ?? "", model: this.plugin.settings.model });
        const out = await p.chat([{ role: "user", content: "ping" }], { maxTokens: 5 });
        new Notice(t("settings.test.ok", { snippet: out.slice(0, 40) }));
      } catch (e) { new Notice(t("settings.test.fail", { msg: (e as Error).message })); }
    }));

    // 本月用量
    this.usage.get().then(u => {
      new Setting(containerEl).setName(t("settings.usage.name")).setDesc(t("settings.usage.desc", { input: u.inputTokens, output: u.outputTokens, month: u.month }));
    });
  }
}
