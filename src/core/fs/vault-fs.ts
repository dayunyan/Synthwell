// src/core/fs/vault-fs.ts — vault adapter 路径/目录小工具。
// Obsidian DataAdapter.mkdir 单层(等同 fs.mkdir 无 recursive),write 不自动建父目录,
// 故写 .shiyue/x.json 或 拾阅笔记/知识点/书/y.md 前须逐级建目录,否则 ENOENT。

export interface FsAdapter {
  exists(path: string): Promise<boolean>;
  mkdir?(path: string): Promise<void>;
}

/** 取路径的目录部分(.shiyue/a.json → .shiyue)。根文件 → 空串。 */
export function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

/** 逐级 mkdir 每一级不存在的目录段。mkdir 可选:mock adapter 可不带
 *  (则跳过,write 走 store 不报 ENOENT);真实 adapter 有 mkdir → 正常建目录。 */
export async function ensureFolder(adapter: FsAdapter, folderPath: string): Promise<void> {
  let cur = "";
  for (const part of folderPath.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(await adapter.exists(cur))) await adapter.mkdir?.(cur);
  }
}
