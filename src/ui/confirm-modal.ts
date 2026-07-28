// src/ui/confirm-modal.ts
import { App, Modal } from "obsidian";

export interface CostInfo { book: string; chunks: number; tokens: number; cost: number; }

/** 预估花费弹窗:点「继续」返回 true,关闭/取消/Esc 返回 false。
 *  从 main.ts 抽出(Task 9 extraction-controller 复用)。 */
export function confirmCost(app: App, info: CostInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new Modal(app);
    m.titleEl.setText("抽取知识点 — 预估花费");
    m.contentEl.createEl("p", { text: `《${info.book}》:约 ${info.chunks} 块 / ${info.tokens} tokens,预计 ¥${info.cost.toFixed(3)}。继续?` });
    const btns = m.contentEl.createDiv({ cls: "shiyue-confirm-btns" });
    const yes = btns.createEl("button", { text: "继续" });
    const no = btns.createEl("button", { text: "取消" });
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; m.close(); resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    m.onClose = () => done(false);
    m.open();
  });
}
