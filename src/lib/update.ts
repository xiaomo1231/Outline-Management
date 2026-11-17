// 检查更新：只在作者点按钮时问一次 GitHub Releases，不自动联网，也不自动下载安装。
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
  return { latest, newer: compareVersions(latest, APP_VERSION) > 0, url: j.html_url || RELEASES_URL, notes: String(j.body ?? ""), publishedAt: String(j.published_at ?? "") };
}

/** 用系统浏览器打开发布页 */
export async function openReleasePage(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}
