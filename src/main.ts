import { Plugin } from "obsidian";

export default class ShiyuePlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "shiyue-hello",
      name: "拾阅: 验证加载",
      callback: () => {
        // Task 2 registers the view this command opens
      },
    });
  }
}
