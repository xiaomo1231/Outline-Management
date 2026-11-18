import type { Arc, Chapter, Character, Scene, StoryEvent, Volume } from "./types";
import { mentioned } from "./mention";
import { uid } from "./util";
import { phaseName, where, bookLen } from "./plan";

export interface ChRef {
  ch: Chapter;
  v: number;
  c: number;
  /** 全书章号，从 1 开始 */
  no: number;
}

export function allChapters(vols: Volume[]): ChRef[] {
  const out: ChRef[] = [];
  let no = 0;
  vols.forEach((vol, v) => vol.chapters.forEach((ch, c) => out.push({ ch, v, c, no: ++no })));
  return out;
}

export function chapterLabel(vols: Volume[], id: string | null | undefined): string {
  if (!id) return "未指定";
  const r = allChapters(vols).find((x) => x.ch.id === id);
  return r ? `第${r.no}章` : "未指定";
}

export function chapterFull(r: ChRef) {
  return `第${r.no}章 ${r.ch.title || "（未命名）"}`;
}

export function findChapter(vols: Volume[], id: string | null | undefined): ChRef | undefined {
  return id ? allChapters(vols).find((x) => x.ch.id === id) : undefined;
}

export interface ScRef {
  s: Scene;
  r: ChRef;
  i: number;
}
export function findScene(vols: Volume[], id: string | null | undefined): ScRef | undefined {
  if (!id) return;
  for (const r of allChapters(vols)) {
    const i = r.ch.scenes.findIndex((s) => s.id === id);
    if (i >= 0) return { s: r.ch.scenes[i], r, i };
  }
}

export function newScene(t = "新场景"): Scene {
  return { id: uid("s"), t, goal: "", conf: "", who: [], plant: "", pay: "" };
}
export function newChapter(title = ""): Chapter {
  return { id: uid("c"), title, status: "大纲", scenes: [] };
}

/** 场景和事件共享、互相保持一致的字段 */
export const SHARE = ["t", "day", "time", "place", "result", "reveal"] as const;

/** 故事时间的写法：0 和负数是开篇之前（前史） */
export function dayLabel(d: number | null | undefined): string {
  if (d == null) return "时间未定";
  return d > 0 ? `第 ${d} 天` : d === 0 ? "第 0 天（开篇前）" : `开篇前 ${-d} 天`;
}

export function link(s: Scene, e: StoryEvent) {
  s.ev = e.id;
  e.sc = s.id;
}

function splitWho(w: string, names: string[]): string[] {
  return (w || "")
    .split(/[、,，\s]+/)
    .filter(Boolean)
    .map((n) => names.find((k) => k === n || k.includes(n)) || n);
}

/**
 * 没填故事时间时推断第几天：本章场景里有就用本章的；
 * 否则从前面最近一个填了时间的章往后数，每章算一天；前面都没填，就按「第 N 章 ≈ 第 N 天」。
 */
export function guessDay(vols: Volume[], r: ChRef): number {
  return dayGuess(vols, r).day;
}
export function dayGuess(vols: Volume[], r: ChRef): { day: number; sure: boolean } {
  const own = r.ch.scenes.map((s) => s.day).filter((d): d is number => d != null);
  if (own.length) return { day: Math.max(...own), sure: true };
  let at: { no: number; day: number } | null = null;
  for (const x of allChapters(vols)) {
    if (x.no >= r.no) break;
    const ds = x.ch.scenes.map((s) => s.day).filter((d): d is number => d != null);
    if (ds.length) at = { no: x.no, day: Math.max(...ds) };
  }
  return at ? { day: at.day + (r.no - at.no), sure: false } : { day: r.no, sure: false };
}

/** 没有场景的章，用章名和本章大纲在时间线上记一条事件 */
export function chapterToEvent(vols: Volume[], events: StoryEvent[], r: ChRef, day?: number): StoryEvent {
  const e: StoryEvent = { id: uid("e"), day: day ?? guessDay(vols, r), ch: r.ch.id, t: r.ch.title || `第${r.no}章`, who: "", ty: "main", process: r.ch.ol || "", from: "大纲（整章）" };
  events.push(e);
  return e;
}

export function targetChapter(vols: Volume[], e: StoryEvent): { r: ChRef; why: string } | null {
  const all = allChapters(vols);
  if (!all.length) return null;
  const x = e.ch && all.find((y) => y.ch.id === e.ch);
  if (x) return { r: x, why: "按事件表里填的章节" };
  let best: ChRef | null = null;
  for (const y of all) if (y.ch.scenes.some((s) => s.day != null && s.day <= e.day)) best = y;
  return { r: best || all[all.length - 1], why: "没填章节，按故事时间推断" };
}

/** 事件 → 大纲：在目标章里新建场景并关联。vols 和 e 都是可修改的草稿。 */
export function eventToOutline(vols: Volume[], e: StoryEvent, names: string[]): Scene | null {
  const t = targetChapter(vols, e);
  if (!t) return null;
  const s: Scene = { ...newScene(e.t), who: splitWho(e.who, names), plant: e.ty === "plant" ? e.fore || e.t : "", pay: e.ty === "pay" ? e.fore || e.t : "", day: e.day, time: e.time || "", place: e.place || "", result: e.result || "", reveal: e.reveal || "", from: "时间线" };
  vols[t.r.v].chapters[t.r.c].scenes.push(s);
  link(s, e);
  e.ch = t.r.ch.id;
  return s;
}

/** 场景 → 时间线：新建事件并关联 */
export function sceneToEvent(vols: Volume[], events: StoryEvent[], s: Scene, r: ChRef, day?: number): StoryEvent {
  const e: StoryEvent = { id: uid("e"), day: s.day ?? day ?? guessDay(vols, r), time: s.time || "", ch: r.ch.id, t: s.t, who: s.who.join("、"), ty: s.pay ? "pay" : s.plant ? "plant" : "main", fore: s.pay || s.plant || "", place: s.place || "", result: s.result || "", reveal: s.reveal || "", from: "大纲" };
  if (s.day == null) s.day = e.day;
  events.push(e);
  link(s, e);
  return e;
}

export function sortEvents(events: StoryEvent[]) {
  events.sort((a, b) => a.day - b.day || String(a.time || "~").localeCompare(String(b.time || "~")));
}

/* ---------------- 三处同步 ---------------- */

export type SyncSec = "A" | "B" | "C" | "D";
export const SEC: Record<SyncSec, [string, string]> = {
  A: ["时间线 → 大纲", "还没进大纲的事件，变成对应章里的场景"],
  B: ["大纲 → 时间线", "还没进时间线的场景，变成事件"],
  C: ["篇幅规划 → 大纲", "按规划给章节标上事件段和阶段"],
  D: ["大纲 → 篇幅规划", "按大纲里实际的章数回写规划"],
};

export interface SyncData {
  vols: Volume[];
  events: StoryEvent[];
  plan: Arc[];
}
export interface SyncItem {
  key: string;
  sec: SyncSec;
  on: boolean;
  lab: string;
  why?: string;
  /** 在草稿上执行 */
  run: (d: SyncData, names: string[]) => void;
}
export interface SyncNote {
  sec: SyncSec;
  t: string;
}

function rng(ns: number[]) {
  const s = [...ns].sort((a, b) => a - b);
  return s.length > 1 ? `${s[0]}–${s[s.length - 1]}` : `${s[0]}`;
}

/**
 * 生成同步预览。每一项的 run 只依赖 id，所以可以在之后的草稿上执行。
 * 执行顺序：A、B、D、C（先让规划吸收大纲的改动，再按新规划给未归属的章打标签）。
 */
export function buildSync(d: SyncData): { items: SyncItem[]; notes: SyncNote[] } {
  const items: SyncItem[] = [];
  const notes: SyncNote[] = [];
  const all = allChapters(d.vols);
  for (const e of d.events) {
    if (e.sc) continue;
    const t = targetChapter(d.vols, e);
    if (!t) continue;
    const id = e.id;
    const pre = e.day <= 0;
    const hid = e.ty === "hidden";
    items.push({ key: "A" + id, sec: "A", on: !pre && !hid, lab: `「${e.t}」→ ${chapterFull(t.r)}，新建场景`, why: hid ? "这是暗线/幕后事件，读者看不到，一般不写成场景，默认不勾" : pre ? "这是开篇之前的前史，一般不单独写成场景，默认不勾" : t.why, run: (x, names) => { const ev = x.events.find((y) => y.id === id); if (ev && !ev.sc) eventToOutline(x.vols, ev, names); } });
  }
  for (const r of all)
    for (const s of r.ch.scenes) {
      if (s.ev) continue;
      const sid = s.id;
      const g = dayGuess(d.vols, r);
      const day = s.day ?? g.day;
      // 预览里显示的天数就是执行时用的天数
      items.push({ key: "B" + sid, sec: "B", on: s.day != null || g.sure, lab: `「${s.t}」→ ${dayLabel(day)}，新建事件`, why: s.day != null ? "故事时间取自场景" : g.sure ? "场景没填故事时间，取本章其他场景的" : "没填故事时间，暂按章节顺序推断（一章算一天），确认后再勾", run: (x) => { const f = findScene(x.vols, sid); if (f && !f.s.ev) sceneToEvent(x.vols, x.events, f.s, f.r, day); } });
    }
  // 还没有场景、但写了章名或本章大纲的章，整章记一条事件
  for (const r of all) {
    if (r.ch.scenes.length || !(r.ch.title.trim() || r.ch.ol?.trim())) continue;
    if (d.events.some((e) => e.ch === r.ch.id)) continue;
    const cid = r.ch.id;
    const g = dayGuess(d.vols, r);
    items.push({ key: "BC" + cid, sec: "B", on: true, lab: `第${r.no}章「${r.ch.title || "（未命名）"}」整章 → ${dayLabel(g.day)}，新建事件`, why: "这一章还没有场景，用章名和本章大纲记一条；天数按章节顺序推断，进时间线后可以改", run: (x) => { const f = allChapters(x.vols).find((y) => y.ch.id === cid); if (f && !x.events.some((e) => e.ch === cid)) chapterToEvent(x.vols, x.events, f, g.day); } });
  }
  if (!d.plan.length) return { items, notes };

  const untag: string[] = [];
  const mism: string[] = [];
  const mismWhy: string[] = [];
  let maxN = 0;
  for (const r of all) {
    maxN = Math.max(maxN, r.no);
    const w = where(d.plan, r.no);
    if (!w) continue;
    if (!r.ch.pl) untag.push(r.ch.id);
    else if (r.ch.pl.a !== w.a || r.ch.pl.p !== w.p) {
      mism.push(r.ch.id);
      mismWhy.push(`第${r.no}章 ${phaseName(d.plan, r.ch.pl)} → ${phaseName(d.plan, w)}`);
    }
  }
  const tag = (ids: string[]) => (x: SyncData) => {
    for (const r of allChapters(x.vols)) if (ids.includes(r.ch.id)) { const w = where(x.plan, r.no); if (w) x.vols[r.v].chapters[r.c].pl = w; }
  };
  if (untag.length) items.push({ key: "C1", sec: "C", on: false, lab: `给 ${untag.length} 个还没归属的章标上事件段和阶段`, why: all.filter((r) => untag.includes(r.ch.id)).map((r) => `第${r.no}章 ${phaseName(d.plan, where(d.plan, r.no))}`).join("；"), run: tag(untag) });
  if (mism.length) items.push({ key: "C2", sec: "C", on: false, lab: `按规划改回 ${mism.length} 个章的归属，会覆盖你在大纲里改过的`, why: mismWhy.join("；"), run: tag(mism) });
  const N = bookLen(d.plan);
  if (N > maxN)
    items.push({ key: "C3", sec: "C", on: false, lab: `补建第 ${maxN + 1}–${N} 章的空章（${N - maxN} 章），每章带上所属阶段`, why: "空章只有章号和阶段，不写内容", run: (x) => {
      if (!x.vols.length) x.vols.push({ id: uid("v"), title: "第一卷", chapters: [] });
      const v = x.vols[x.vols.length - 1];
      const have = allChapters(x.vols).length;
      for (let n = have + 1; n <= bookLen(x.plan); n++) v.chapters.push({ ...newChapter(), pl: where(x.plan, n) });
    } });

  // 大纲 → 规划：只改「已经写过去」的阶段，大纲写到的最后一个阶段还没写完，不动
  const cnt = new Map<string, number[]>();
  for (const r of all) if (r.ch.pl) { const k = `${r.ch.pl.a}:${r.ch.pl.p}`; cnt.set(k, [...(cnt.get(k) || []), r.no]); }
  const pos = (a: number, p: number) => { let i = 0; for (let j = 0; j < a; j++) i += 1 + d.plan[j].ph.length; return i + 1 + p; };
  let last = -1;
  for (const k of cnt.keys()) { const [a, p] = k.split(":").map(Number); last = Math.max(last, pos(a, p)); }
  for (const [k, nos] of cnt) {
    const [a, p] = k.split(":").map(Number);
    const arc = d.plan[a];
    if (!arc || (p >= 0 && !arc.ph[p])) continue;
    const c = nos.length;
    const cur = p < 0 ? arc.gap : arc.ph[p].c;
    const nm = `${arc.name} · ${p < 0 ? "段前过渡" : arc.ph[p].n}`;
    if (c === cur) continue;
    if (pos(a, p) >= last) { notes.push({ sec: "D", t: `「${nm}」大纲里目前 ${c} 章、规划 ${cur} 章。这是大纲写到的最后一个阶段，还没写完，先不改。` }); continue; }
    items.push({ key: "D" + k, sec: "D", on: true, lab: `「${nm}」${cur} 章 → ${c} 章`, why: `大纲里归到这个阶段的是第 ${rng(nos)} 章`, run: (x) => { const ar = x.plan[a]; if (!ar) return; if (p < 0) ar.gap = c; else if (ar.ph[p]) ar.ph[p].c = c; } });
  }
  return { items, notes };
}

export const RUN_ORDER: SyncSec[] = ["A", "B", "D", "C"];

/** 伏笔板：从场景和事件里汇总埋下和收回的伏笔 */
export interface Plant {
  name: string;
  plantNo: number | null;
  payNo: number | null;
}
export function plants(vols: Volume[], events: StoryEvent[]): Plant[] {
  const m = new Map<string, Plant>();
  const get = (n: string) => { if (!m.has(n)) m.set(n, { name: n, plantNo: null, payNo: null }); return m.get(n)!; };
  for (const r of allChapters(vols))
    for (const s of r.ch.scenes) {
      if (s.plant) { const p = get(s.plant.trim()); p.plantNo = p.plantNo ?? r.no; }
      if (s.pay) { const p = get(s.pay.replace(/（.*?）/g, "").trim()); p.payNo = r.no; }
    }
  for (const e of events) {
    const n = (e.fore || "").replace(/^(埋|收)[:：]/, "").trim();
    if (!n) continue;
    const no = e.ch ? findChapter(vols, e.ch)?.no ?? null : null;
    const p = get(n);
    if (e.ty === "plant") p.plantNo = p.plantNo ?? no;
    if (e.ty === "pay") p.payNo = no ?? p.payNo;
  }
  return [...m.values()];
}

/* ---------------- 卷大纲拆成逐章大纲 ---------------- */

export interface SplitChapterIn {
  t: string;
  ol: string;
  hook?: string;
  scenes: { t: string; goal: string; conf: string; who: string[]; plant?: string; pay?: string; day?: number | null; place?: string }[];
}

/**
 * 把 AI 拆好的逐章大纲放进第 v 卷：按顺序先填这一卷已有的章（只填空着的章名、大纲、钩子；
 * 已经有场景的章不加场景），不够再在卷末新建章。新场景自动加进时间线。
 */
export function applyVolumeSplit(vols: Volume[], events: StoryEvent[], v: number, list: (SplitChapterIn | null)[], toTimeline = true, chars: Pick<Character, "name" | "f">[] = []): { filled: number; added: number; scenes: number } {
  const vol = vols[v];
  let filled = 0;
  let added = 0;
  let scenes = 0;
  const fresh = new Set<string>();
  if (!vol) return { filled, added, scenes };
  const base = vol.chapters.length;
  list.forEach((x, i) => {
    // 没勾选的跳过
    if (!x) return;
    let ch = i < base ? vol.chapters[i] : undefined;
    if (ch) {
      let touched = false;
      if (!ch.title.trim() && x.t) (ch.title = x.t), (touched = true);
      if (!ch.ol?.trim() && x.ol) (ch.ol = x.ol), (touched = true);
      if (!ch.hook?.trim() && x.hook) (ch.hook = x.hook), (touched = true);
      if (ch.scenes.length) {
        if (touched) filled++;
        return;
      }
      if (touched || x.scenes.length) filled++;
    } else {
      ch = { ...newChapter(x.t), ol: x.ol, hook: x.hook || "" };
      vol.chapters.push(ch);
      added++;
    }
    for (const s of x.scenes) {
      const sc: Scene = { ...newScene(s.t), goal: s.goal, conf: s.conf, who: [...new Set([...(s.who ?? []), ...mentioned(chars, [s.t, s.goal, s.conf].join("\n"))])], plant: s.plant || "", pay: s.pay || "", day: s.day ?? null, place: s.place || "", ai: true };
      ch.scenes.push(sc);
      fresh.add(sc.id);
      scenes++;
    }
  });
  if (toTimeline) {
    for (const r of allChapters(vols)) {
      if (r.v !== v) continue;
      for (const s of r.ch.scenes) if (fresh.has(s.id) && !s.ev) sceneToEvent(vols, events, s, r);
    }
    sortEvents(events);
  }
  return { filled, added, scenes };
}

/** 「快速加多章」：一行一章，「｜」或「|」分开章名、本章大纲、章末钩子 */
export function parseQuickChapters(text: string): { t: string; ol: string; hook: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [t = "", ol = "", hook = ""] = l.split(/\s*[｜|]\s*/);
      return { t: t.replace(/^第[0-9一二三四五六七八九十百千]+章[\s：:、.]*/, "").trim(), ol: ol.trim(), hook: hook.trim() };
    });
}

/** AI 回答的第一行有用的话，跳过「好的，下面是……：」这类开场白和 Markdown 符号 */
export function firstLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    // 只去掉列表序号「1.」「2、」，不吃掉「1937年」这种开头的数字
    .map((l) => l.replace(/^[\s#>*\-•]+/, "").replace(/^\d+[.、)](?!\d)\s*/, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean);
  const good = lines.find((l) => !/^(好的|当然|以下|下面|这是|没问题)/.test(l) && !/[:：]$/.test(l));
  return good ?? lines[0] ?? "";
}

/** 把「第1章 …… 第2章 ……」形式的多章大纲拆开 */
export function splitChapterOutline(text: string): { t: string; ol: string }[] {
  const out: { t: string; ol: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/^[\s#>*\-•]+/, "").replace(/[*_`]/g, "").trim();
    if (!l) continue;
    const m = /^第\s*([0-9一二三四五六七八九十百]+)\s*章[\s：:、.，,—\-]*(.*)$/.exec(l);
    if (m) {
      const rest = m[2].trim();
      const [t, ...more] = rest.split(/[：:｜|—]\s*/);
      out.push({ t: (t || `第${m[1]}章`).trim(), ol: more.length ? [more.join("：").trim()] : [] });
    } else if (out.length) out[out.length - 1].ol.push(l);
  }
  return out.map((x) => ({ t: x.t.slice(0, 30), ol: x.ol.join(" ").slice(0, 400) }));
}
