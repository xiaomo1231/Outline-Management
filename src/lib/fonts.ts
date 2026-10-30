import { isTauri } from "./db";

/** 系统里常见的中文字体，Windows 自带 */
export const SYSTEM_FONTS: [string, string][] = [
  ["var(--f-body)", "宋体（默认）"],
  ['"SimSun","Songti SC",serif', "中易宋体"],
  ['"KaiTi","STKaiti",serif', "楷体"],
  ['"FangSong","STFangsong",serif', "仿宋"],
  ['"Microsoft YaHei","PingFang SC",sans-serif', "微软雅黑"],
  ['"SimHei","Heiti SC",sans-serif', "黑体"],
];

async function register(name: string, data: ArrayBuffer) {
  const face = new FontFace(name, data);
  await face.load();
  (document.fonts as any).add(face);
}

/** 让作者选一个字体文件导入。桌面版记住路径，下次自动加载。 */
export async function importFont(): Promise<{ name: string; path: string } | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "字体", extensions: ["ttf", "otf", "woff", "woff2", "ttc"] }] });
    if (!path || Array.isArray(path)) return null;
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(path);
    const name = "导入·" + path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
    await register(name, bytes.buffer as ArrayBuffer);
    return { name, path };
  }
  return new Promise((res) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".ttf,.otf,.woff,.woff2";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return res(null);
      const name = "导入·" + f.name.replace(/\.[^.]+$/, "");
      await register(name, await f.arrayBuffer());
      res({ name, path: "" });
    };
    inp.click();
  });
}

/** 启动时把以前导入的字体加载回来 */
export async function loadSavedFonts(list: { name: string; path: string }[]) {
  if (!isTauri) return;
  const { readFile } = await import("@tauri-apps/plugin-fs");
  for (const f of list) {
    try {
      const bytes = await readFile(f.path);
      await register(f.name, bytes.buffer as ArrayBuffer);
    } catch {
      /* 文件被移走了就跳过 */
    }
  }
}
