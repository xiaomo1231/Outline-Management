import { idbGet, idbPut, isTauri } from "./db";

/** 网页版没有文件路径：字体文件存进 IndexedDB，路径记成 idb:键名 */
const IDB_PREFIX = "idb:";

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

/** 让作者选一个字体文件导入。桌面版记住路径，网页版存进 IndexedDB，下次自动加载。 */
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
      const buf = await f.arrayBuffer();
      await register(name, buf);
      // 存不进去（无痕模式等）就只在这次打开期间有效
      const key = "font:" + name;
      const path = await idbPut(key, new Uint8Array(buf)).then(
        () => IDB_PREFIX + key,
        () => "",
      );
      res({ name, path });
    };
    inp.click();
  });
}

/** 已经加载过（或正在加载）的字体名：App 和写作页都会调，别重复注册 */
const loaded = new Set<string>();

/** 启动时把以前导入的字体加载回来 */
export async function loadSavedFonts(list: { name: string; path: string }[]) {
  const readFile = isTauri ? (await import("@tauri-apps/plugin-fs")).readFile : null;
  for (const f of list) {
    try {
      if (loaded.has(f.name)) continue;
      loaded.add(f.name);
      const bytes = f.path.startsWith(IDB_PREFIX) ? await idbGet(f.path.slice(IDB_PREFIX.length)) : readFile ? await readFile(f.path) : undefined;
      if (!bytes) continue;
      await register(f.name, bytes.buffer as ArrayBuffer);
    } catch {
      loaded.delete(f.name);
      /* 文件被移走了就跳过 */
    }
  }
}
