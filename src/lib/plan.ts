import type { Arc, PhaseKind, Volume } from "./types";

export const KIND: Record<PhaseKind, string> = { trans: "过渡", body: "主体", peak: "高潮", end: "收尾", free: "自定义" };

/** 按事件类型给出各阶段的常见比例 */
export const RATIO: Record<string, [PhaseKind, string, number][]> = {
  explore: [["trans", "出发前", 0.13], ["body", "探索", 0.55], ["peak", "高潮", 0.15], ["end", "收尾", 0.17]],
  fight: [["trans", "起因", 0.15], ["body", "交锋", 0.45], ["peak", "决战", 0.25], ["end", "收尾", 0.15]],
  romance: [["trans", "靠近", 0.25], ["body", "拉扯", 0.45], ["peak", "挑明", 0.15], ["end", "余温", 0.15]],
  mystery: [["trans", "疑点", 0.2], ["body", "调查", 0.5], ["peak", "揭晓", 0.15], ["end", "回响", 0.15]],
  daily: [["body", "日常", 0.8], ["end", "转折", 0.2]],
};
export const TYPES: [string, string][] = [["explore", "探索"], ["fight", "对抗"], ["romance", "感情线"], ["mystery", "揭秘"], ["daily", "日常"]];
export const PHASE_GOAL: Record<PhaseKind, string> = { trans: "交代动机和入口，不要拖", body: "每 4–6 章一个小转折", peak: "把前面埋的线收拢", end: "留下下一段的引子", free: "" };

export const total = (a: Arc) => a.ph.reduce((s, p) => s + p.c, 0);
export const bookLen = (plan: Arc[]) => plan.reduce((s, a) => s + a.gap + total(a), 0);

export interface Range {
  g0: number;
  g1: number;
  s: number;
  e: number;
}
export function ranges(plan: Arc[]): Range[] {
  let cur = 1;
  return plan.map((a) => {
    const g0 = cur;
    cur += a.gap;
    const s = cur;
    cur += total(a);
    return { g0, g1: s - 1, s, e: cur - 1 };
  });
}

/** 第 n 章在规划里属于哪个事件段的哪个阶段；p = -1 表示段前过渡 */
export function where(plan: Arc[], n: number): { a: number; p: number } | null {
  const R = ranges(plan);
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    if (n >= r.g0 && n <= r.g1) return { a: i, p: -1 };
    if (n >= r.s && n <= r.e) {
      let c = r.s;
      for (let j = 0; j < plan[i].ph.length; j++) {
        c += plan[i].ph[j].c;
        if (n < c) return { a: i, p: j };
      }
    }
  }
  return null;
}

export function phaseName(plan: Arc[], w: { a: number; p: number } | null | undefined): string {
  if (!w) return "";
  const a = plan[w.a];
  if (!a) return "";
  if (w.p < 0) return `${a.name} · 段前过渡`;
  const p = a.ph[w.p];
  return p ? `${a.name} · ${p.n}` : "";
}

/** 把四舍五入后的章数凑成总数 T：多出来的给 main；超了先从 main、再从章数最多的阶段扣，每个阶段至少 1 章 */
function fit(cs: number[], T: number, main: number) {
  let d = T - cs.reduce((s, c) => s + c, 0);
  if (d > 0) cs[main] += d;
  while (d < 0) {
    const i = cs[main] > 1 ? main : cs.indexOf(Math.max(...cs));
    if (cs[i] <= 1) break;
    cs[i]--;
    d++;
  }
}

/** 新事件段：按类型比例分配章数，余数给主体。每个阶段至少 1 章，所以总数不会少于阶段数 */
export function newArc(name: string, type: string, T: number, gap: number): Arc {
  const r = RATIO[type] ?? RATIO.explore;
  const cs = r.map(([, , x]) => Math.max(1, Math.round(x * T)));
  const body = r.findIndex(([k]) => k === "body");
  fit(cs, T, body >= 0 ? body : 0);
  const ph = r.map(([k, n], i) => ({ k, n, c: cs[i], g: PHASE_GOAL[k], ai: true }));
  return { name, gap, ph };
}

/** 按新的总章数等比例重新分配，差额给最后一个阶段。返回实际总数（每个阶段至少 1 章） */
export function redistribute(a: Arc, T: number): number {
  const old = total(a) || 1;
  const cs = a.ph.map((p) => Math.max(1, Math.round((p.c / old) * T)));
  fit(cs, T, cs.length - 1);
  a.ph.forEach((p, i) => (p.c = cs[i]));
  return total(a);
}

/** 删掉第 ai 个事件段（给了 pi 就只删其中第 pi 个阶段）后，各章的所属阶段跟着改：属于被删部分的清空，后面的下标前移 */
export function dropPl(vols: Volume[], ai: number, pi?: number) {
  for (const v of vols)
    for (const c of v.chapters) {
      const pl = c.pl;
      if (!pl) continue;
      if (pi == null) {
        if (pl.a === ai) c.pl = null;
        else if (pl.a > ai) pl.a--;
      } else if (pl.a === ai) {
        if (pl.p === pi) c.pl = null;
        else if (pl.p > pi) pl.p--;
      }
    }
}

export interface PaceIssue {
  lv: "r" | "y" | "g";
  text: string;
  fix?: { a: number; p?: number; act: "split" | "gap" };
}

/** 不调 AI 的节奏检查 */
export function paceCheck(plan: Arc[]): PaceIssue[] {
  const out: PaceIssue[] = [];
  const R = ranges(plan);
  plan.forEach((a, ai) => {
    a.ph.forEach((p, pi) => {
      if (p.k === "body" && p.c >= 14) out.push({ lv: "y", text: `「${a.name}」的「${p.n}」连续 ${p.c} 章没有阶段性高潮，读者容易疲。建议拆成两段，中间加一个 2 章的小高潮。`, fix: { a: ai, p: pi, act: "split" } });
    });
    if (ai > 0 && a.gap < 2) out.push({ lv: "r", text: `「${a.name}」和上一段只隔 ${a.gap} 章，上一段高潮的情绪还没落地就进入新事件。建议至少 2–3 章过渡。`, fix: { a: ai, act: "gap" } });
    const pk = a.ph.filter((p) => p.k === "peak").reduce((s, p) => s + p.c, 0);
    if (pk && pk / total(a) < 0.1) out.push({ lv: "y", text: `「${a.name}」的高潮只占 ${Math.round((pk / total(a)) * 100)}%，相对 ${total(a)} 章的铺垫偏短。` });
  });
  if (R.length && R[0].s > 1) out.push({ lv: "g", text: `开篇在第 ${R[0].s} 章才进入第一个事件段。` });
  return out;
}

export function applyPaceFix(plan: Arc[], f: NonNullable<PaceIssue["fix"]>) {
  if (f.act === "gap") plan[f.a].gap = 3;
  if (f.act === "split" && f.p != null) {
    const a = plan[f.a];
    const p = a.ph[f.p];
    const h = Math.floor((p.c - 2) / 2);
    a.ph.splice(f.p, 1, { k: "body", n: p.n + "（上）", c: h, g: p.g }, { k: "peak", n: "中段转折", c: 2, g: "一次阶段性的收获或失去", ai: true }, { k: "body", n: p.n + "（下）", c: p.c - 2 - h, g: "" });
  }
}
