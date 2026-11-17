// 检查更新：只在作者点按钮时问一次 GitHub Releases，不自动联网。
// 发现新版就自动下载（核对 SHA-256），下好后作者点一下「安装并重启」。
import { isTauri } from "./db";

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

export const REPO = "xiaomo1231/Outline-Management";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** 比较两个版本号，a 比 b 新返回正数。v 前缀和预发布后缀会被忽略 */
export function compareVersions(a: string, b: string): number {
  const p = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((x) => parseInt(x, 10) || 0);
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface UpdateInfo {
  latest: string;
  newer: boolean;
  url: string;
  notes: string;
  publishedAt: string;
  assets: Asset[];
}

export interface Asset {
  name: string;
  url: string;
  /** "sha256:..."，GitHub 发布页给的校验值 */
  digest: string;
  size: number;
}

export type UpdateKind = "installer" | "portable";

/** 这一份墨枢该下载哪个文件 */
export function pickAsset(assets: Asset[], kind: UpdateKind): Asset | null {
  const re = kind === "installer" ? /_x64-setup\.exe$/ : /_x64-portable\.exe$/;
  return assets.find((a) => re.test(a.name) && /^sha256:[0-9a-f]{64}$/i.test(a.digest)) ?? null;
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  const init = { headers: { Accept: "application/vnd.github+json" } };
  let res: Response;
  if (isTauri) {
    const { fetch: tfetch } = await import("@tauri-apps/plugin-http");
    res = await tfetch(url, init);
  } else res = await fetch(url, init);
  if (res.status === 404) throw new Error("还没有发布过版本");
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}，稍后再试`);
  const j = await res.json();
  const latest = String(j.tag_name ?? "");
  return { latest, newer: compareVersions(latest, APP_VERSION) > 0, url: j.html_url || RELEASES_URL, notes: String(j.body ?? ""), publishedAt: String(j.published_at ?? ""),
    assets: (Array.isArray(j.assets) ? j.assets : []).map((a: any) => ({ name: String(a.name ?? ""), url: String(a.browser_download_url ?? ""), digest: String(a.digest ?? ""), size: Number(a.size) || 0 })),
  };
}

/** 用系统浏览器打开发布页 */
export async function openReleasePage(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function updateKind(): Promise<UpdateKind> {
  return (await invoke<string>("update_kind")) === "installer" ? "installer" : "portable";
}

/** 下载新版到临时目录，返回文件路径。onProgress(已下载, 总大小) */
export async function downloadUpdate(a: Asset, onProgress?: (got: number, total: number) => void): Promise<string> {
  const { listen } = await import("@tauri-apps/api/event");
  const off = await listen<[number, number]>("update-progress", (e) => onProgress?.(e.payload[0], e.payload[1]));
  try {
    return await invoke<string>("update_download", { url: a.url, name: a.name, sha256: a.digest });
  } finally {
    off();
  }
}

/** 先把没存的正文存掉、给数据库备份一份，再安装并重启 */
export async function installUpdate(path: string, prepare: () => Promise<void>): Promise<void> {
  await prepare();
  await invoke("update_install", { path });
}
