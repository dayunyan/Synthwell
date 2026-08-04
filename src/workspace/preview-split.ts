// src/workspace/preview-split.ts
import { App, Notice, TFile, WorkspaceLeaf, type WorkspaceSplit } from "obsidian";
import type { PreviewContext } from "./preview-context.ts";
import { t } from "../i18n/index.ts";

/** 写侧 adapter 的小 interface:布局操作收进此面,藏大脆性布局 API
 *  (duplicateLeaf/createLeafBySplit/createLeafInParent/setActiveLeaf 的反直觉 + 易碎)。
 *  小 interface 藏大脆性——调用方(ShiyueWorkspace)只依赖此面,可注 fake 测/换实现。
 *  读侧 leaf 来源 = PreviewContext.getPreviewLeaf()(#1 纯派生,不存 ref → 无陈旧)。 */
export interface PreviewSplit {
  ensure(): Promise<void>;
  toggle(): Promise<void>;
  openInPreview(file: TFile): Promise<void>;
}

/** PreviewSplit 的拾阅实现(右栏 上 preview / 下 ai 分屏)。藏的脆性点(各 API 的反直觉,逐一注于其调用处):
 *  - setActiveLeaf(leaf,{focus}):duplicateLeaf 按【激活 leaf】而非源 leaf 定位新 tab → 须先切回 preview。
 *  - createLeafBySplit(existingAi,"horizontal",true):preview 真被关时在其上方(before=true)重建。
 *  - createLeafInParent(preview.parent,idx) vs duplicateLeaf(openInPreview 注)。
 *  纯布局,无 Obsidian 事件接线(事件在 PreviewContext);无纯 seam 可单测(同 #1 写侧,人工验)。 */
export class ShiyuePreviewSplit implements PreviewSplit {
  private app: App;
  private previewCtx: PreviewContext;
  private aiViewType: string;

  constructor(app: App, previewCtx: PreviewContext, aiViewType: string) {
    this.app = app; this.previewCtx = previewCtx; this.aiViewType = aiViewType;
  }

  /** 确保右侧分屏存在(上 preview / 下 ai)。幂等:已存在则聚焦,preview 失效则重建。
   *  不 toggle——纯 "ensure exists"。logo 点击走 toggle。
   *  preview 是否仍存活由 previewCtx.getPreviewLeaf() 现派生(空/刚建 leaf 仍在结构中 → 不重建;
   *  真被 detach → 走不出 leaf → 重建)。 */
  async ensure(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    if (existingAi) {
      await this.app.workspace.setActiveLeaf(existingAi, { focus: true });
      if (!this.previewCtx.getPreviewLeaf()) {
        // preview 真被关(结构走不出 leaf):在 ai 上方(horizontal split, before=true)重建。
        this.app.workspace.createLeafBySplit(existingAi, "horizontal", true);
      }
      return;
    }
    // 首次:active leaf(通常是 graph)向右分屏 → preview;再向下分屏 → ai
    const preview = this.app.workspace.getLeaf("split", "vertical") as WorkspaceLeaf;
    await this.app.workspace.setActiveLeaf(preview, { focus: false });
    const ai = this.app.workspace.getLeaf("split", "horizontal") as WorkspaceLeaf;
    await ai.setViewState({ type: this.aiViewType, state: {} });
    // preview 尚无文件,不挂选区捕获(等 openInPreview 的 openFile 后 view 稳定再挂——ShiyueWorkspace.syncSelectionCapture)
  }

  /** logo 点击:toggle 右侧两屏。已存在 → 收起(detach 预览 + AI leaf);不存在 → ensure。
   *  收起后 detach 让结构走不出 leaf → previewCtx 派生 null → layout-change 自动 fire none 禁用面板。
   *  选区捕获(document 级 pointerdown 监听 + 浮按钮)的摘除留 ShiyueWorkspace(选区接线,非布局),
   *  它在调本方法前先 detach captureHandle,故此处只做布局 teardown。 */
  async toggle(): Promise<void> {
    const existingAi = this.app.workspace.getLeavesOfType(this.aiViewType)[0] ?? null;
    const preview = this.previewCtx.getPreviewLeaf();
    if (existingAi || preview) {
      preview?.detach();
      existingAi?.detach();
      return;
    }
    await this.ensure();
  }

  /** 确保 split + 打开 file。preview 有文件 → 同 tab 组新 tab;preview 空 → 替换。
   *
   *  关键赌注(#2):hasDoc 新 tab 路径用 createLeafInParent(preview.parent, idx) 替 duplicateLeaf。
   *   - 旧(duplicateLeaf):setActiveLeaf(preview) + duplicateLeaf(preview,"tab") → tab 对(Bug1 不回归),
   *     但 duplicateLeaf 复制 #1 PDF 视图 → openFile(#2) destroy 旧 transport → `Transport destroyed` console noise(无害,#1 仍渲染)。
   *   - 新(createLeafInParent):preview.parent 是 WorkspaceTabs(#1 derive 已确认:aiLeaf→aiTabs→split→previewTabs→children[currentTab])。
   *     createLeafInParent 在 WorkspaceTabs 上应加 tab(同组)而非 spawn 窗——建【空 leaf】(不复制视图)→
   *     openFile(#2) 现载 → 无 transport churn → 消 noise。obsidian.d.ts 声参为 WorkspaceSplit(与 WorkspaceTabs 为
   *     WorkspaceParent 兄弟子类),运行时实受任意 WorkspaceParent → 须 cast。
   *   - 验证(已通过 2026-08-02,HITL):createLeafInParent 后 target.parent === preview.parent(同组=tab,kind=WorkspaceTabs)
   *     + 无 Transport destroyed + #1 不破 → 赌注成,Transport noise 消除。回退路径 duplicateLeaf 已弃(留备查):
   *     若未来 Obsidian 升级致 spawn 窗或 #1 破,改回 setActiveLeaf(preview,{focus:false}) + duplicateLeaf(preview,"tab"),
   *     接受 noise 为 cosmetic(已验无害)。
   *   - 新 tab 须为激活(currentTab 指它)previewCtx 才派生取到 target → 显式 setActiveLeaf(target) 兜底
   *     (createLeafInParent 是否自动激活未保证;setActive 幂等,已激活则 no-op)。 */
  async openInPreview(file: TFile): Promise<void> {
    await this.ensure();
    const preview = this.previewCtx.getPreviewLeaf();
    if (!preview) { new Notice(t("notice.cantCreatePreview")); return; }
    const hasDoc = !!this.previewCtx.getFile();
    let target: WorkspaceLeaf;
    if (hasDoc) {
      // preview.parent 运行时为 WorkspaceTabs(derive 已确认);声参 WorkspaceSplit → cast。
      const parent = preview.parent as unknown as WorkspaceSplit;
      const children = (parent as unknown as { children?: unknown[] }).children;
      const idx = Array.isArray(children) ? children.length : 0;  // 末尾追加 → 新 tab
      target = this.app.workspace.createLeafInParent(parent, idx);
      // 兜底激活新 tab:createLeafInParent 不保证设 currentTab;不激活则 previewCtx 派生旧 leaf →
      // syncSelectionCapture 会挂错 leaf。setActiveLeaf 幂等。
      await this.app.workspace.setActiveLeaf(target, { focus: false });
    } else {
      target = preview;  // 空 → 替换
    }
    await target.openFile(file);
    // 选区捕获挂载留 ShiyueWorkspace.syncSelectionCapture(选区接线,非布局)——openInPreview 返回后它读 previewCtx.getKind()/getPreviewLeaf() 取 target。
  }
}
