// src/workspace/file-menu.ts
import { Plugin, TFile } from "obsidian";
import type { ShiyueWorkspace } from "./shiyue-workspace.ts";
import { t } from "../i18n/index.ts";

/** 注册 file-menu hook:给 .pdf 文件加「在拾阅中打开」→ workspace.openInShiyue。
 *  公开 API(obsidian.d.ts L8109: workspace.on('file-menu', (menu, file, source, leaf)))。 */
export function registerFileMenu(plugin: Plugin, workspace: ShiyueWorkspace): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "pdf") return;
      menu.addItem((i) => {
        i.setTitle(t("menu.openInShiyue")).setIcon("book-open").onClick(() => { void workspace.openInShiyue(file); });
      });
    }),
  );
}
