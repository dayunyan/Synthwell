// src/ui/confirm-modal.ts
import { App, Modal } from "obsidian";
import { t } from "../i18n/index.ts";

export interface CostInfo { book: string; chunks: number; tokens: number; cost: number; }

/** 预估花费弹窗:点「继续」返回 true,关闭/取消/Esc 返回 false。
 *  从 main.ts 抽出(Task 9 extraction-controller 复用)。 */
export function confirmCost(app: App, info: CostInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new Modal(app);
    m.titleEl.setText(t("confirm.title"));
    m.contentEl.createEl("p", { text: t("confirm.body", { book: info.book, chunks: info.chunks, tokens: info.tokens, cost: info.cost.toFixed(3) }) });
    const btns = m.contentEl.createDiv({ cls: "shiyue-confirm-btns" });
    const yes = btns.createEl("button", { text: t("confirm.yes") });
    const no = btns.createEl("button", { text: t("confirm.no") });
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; m.close(); resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    m.onClose = () => done(false);
    m.open();
  });
}

/** 综合笔记覆盖确认弹窗(ADR-0006:重汇总覆盖现存的「汇总 - <basename>.md」)。
 *  点「继续」返 true,关闭/取消/Esc 返 false。键硬编码(与 confirmCost 同模式:specific 弹窗,键内化)。 */
export function confirmOverwriteSynthesis(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new Modal(app);
    m.titleEl.setText(t("synth.overwrite.title"));
    m.contentEl.createEl("p", { text: t("synth.overwrite.body") });
    const btns = m.contentEl.createDiv({ cls: "shiyue-confirm-btns" });
    const yes = btns.createEl("button", { text: t("synth.overwrite.continue") });
    const no = btns.createEl("button", { text: t("synth.overwrite.cancel") });
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; m.close(); resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    m.onClose = () => done(false);
    m.open();
  });
}
