import type { Chapter } from "./types";

/** 分段章纲：存在 ch.ol 里，每段写成「【起因】……」，ch.olSeg 为 true 时按段解析。
 *  这样旧数据（没有 olSeg）照旧是一整段文字，AI 和别的地方读 ch.ol 也不会丢内容。 */
export interface OlSeg {
  k: string;
  t: string;
}

export const OL_KEYS = ["起因", "经过", "转折", "结果"];

const MARK = /【([^【】\n]{0,12})】/g;

/** 把分段章纲拆开。开头没有标记的文字算作一段没有名字的段（比如 AI 改大纲时没带标记） */
export function parseOl(ol: string): OlSeg[] {
  const out: OlSeg[] = [];
  let last = 0;
  let k: string | null = null;
  for (const m of ol.matchAll(MARK)) {
    const t = ol.slice(last, m.index).trim();
    if (k !== null) out.push({ k, t });
    else if (t) out.push({ k: "", t });
    k = m[1].trim();
    last = m.index! + m[0].length;
  }
  const t = ol.slice(last).trim();
  if (k !== null) out.push({ k, t });
  else if (t) out.push({ k: "", t });
  return out;
}

/** 分段写回成一段文字，空段也留着（作者刚加的段还没写字） */
export function joinOl(segs: OlSeg[]): string {
  return segs.map((s) => `【${s.k.replace(/[【】\n]/g, "")}】${s.t.trim()}`).join("\n");
}

/** 自由文字改成分段：按空行或换行切成几段，依次套上 起因/经过/转折/结果；没有文字就给四个空段 */
export function toSegs(ol: string): OlSeg[] {
  const paras = ol.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (!paras.length) return OL_KEYS.map((k) => ({ k, t: "" }));
  if (paras.length === 1) return [{ k: OL_KEYS[0], t: paras[0] }, ...OL_KEYS.slice(1).map((k) => ({ k, t: "" }))];
  return paras.map((t, i) => ({ k: OL_KEYS[i] ?? `第${i + 1}段`, t }));
}

/** 分段改回自由文字：去掉段名，一段一行 */
export function fromSegs(segs: OlSeg[]): string {
  return segs.map((s) => s.t.trim()).filter(Boolean).join("\n");
}

/** 给 AI 和摘要用的一行文字：分段的去掉空段、保留段名；自由文字原样 */
export function olText(ch: Pick<Chapter, "ol" | "olSeg">): string {
  const ol = ch.ol ?? "";
  if (!ch.olSeg) return ol.trim();
  return parseOl(ol)
    .filter((s) => s.t.trim())
    .map((s) => (s.k ? `【${s.k}】` : "") + s.t.trim().replace(/\s*\n\s*/g, " "))
    .join(" ");
}
