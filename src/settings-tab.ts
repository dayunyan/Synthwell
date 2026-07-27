// src/settings-tab.ts — 拾阅设置面板(plan1 task7)。
// 单独成文而非追加到 settings.ts:settings.ts 是纯数据形状(Task 1 单测在
// `node --test --experimental-strip-types` 下跑),若在此 import "obsidian"
// 会让 Node 尝试解析 types-only 的 obsidian 包(main:"")而 ERR_MODULE_NOT_FOUND,
// 连带 settings.test.ts 失败。UI 与 obsidian 耦合,无单测,人工验。
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { OpenAICompatibleProvider } from "./llm-service";
import { UsageTracker } from "./usage";
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
    containerEl.createEl("h2", { text: "拾阅 / Shiyue" });

    new Setting(containerEl).setName("AI 服务商").setDesc("DeepSeek(默认,高性价比)/ OpenAI 兼容").addDropdown(d => d
      .addOption("deepseek", "DeepSeek").addOption("openai-compatible", "OpenAI 兼容")
      .setValue(this.plugin.settings.provider)
      .onChange(async v => { this.plugin.settings.provider = v as any; if (v === "deepseek") { this.plugin.settings.baseURL = "https://api.deepseek.com"; this.plugin.settings.model = "deepseek-v4-flash"; } await this.plugin.saveSettings(); this.display(); }));

    new Setting(containerEl).setName("API Key").setDesc("存于 Obsidian SecretStorage,加密、跨设备不同步").addText(t => {
      t.inputEl.type = "password"; t.setPlaceholder("sk-...");
      // 回填:从 secretStorage 读现有 key(SecretStorage @since 1.11.4,getSecret 同步)
      const existing = this.app.secretStorage.getSecret(SHIYUE_API_KEY_ID);
      if (existing) t.setValue(existing);
      t.onChange(async v => { this.app.secretStorage.setSecret(SHIYUE_API_KEY_ID, v.trim()); });
    });

    new Setting(containerEl).setName("模型").setDesc("默认 deepseek-v4-flash(纯文本)").addText(t => t.setValue(this.plugin.settings.model).onChange(async v => { this.plugin.settings.model = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("Base URL").addText(t => t.setValue(this.plugin.settings.baseURL).onChange(async v => { this.plugin.settings.baseURL = v.trim(); await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName("连接测试").setDesc("发一次最小请求,验证 key/模型可用").addButton(b => b.setButtonText("测试连接").onClick(async () => {
      try {
        const key = this.app.secretStorage.getSecret(SHIYUE_API_KEY_ID);
        const p = new OpenAICompatibleProvider({ baseURL: this.plugin.settings.baseURL, apiKey: key ?? "", model: this.plugin.settings.model });
        const out = await p.chat([{ role: "user", content: "ping" }], { maxTokens: 5 });
        new Notice(`✓ 连接成功:${out.slice(0, 40)}`);
      } catch (e) { new Notice(`✗ 失败:${(e as Error).message}`); }
    }));

    // 本月用量
    this.usage.get().then(u => {
      new Setting(containerEl).setName("本月用量").setDesc(`${u.inputTokens} input / ${u.outputTokens} output tokens(${u.month})`);
    });
  }
}
