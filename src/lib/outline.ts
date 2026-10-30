import type { Arc, Chapter, Scene, StoryEvent, Volume } from "./types";
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
export const SHARE = ["day", "time", "place", "result", "reveal"] as const;

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

export function guessDay(vols: Volume[], r: ChRef): number {
  const own = r.ch.scenes.map((s) => s.day).filter((d): d is number => !!d);
  if (own.length) return Math.max(...own);
  let best = 1;
  for (const x of allChapters(vols)) if (x.no < r.no) for (const s of x.ch.scenes) if (s.day && s.day >= best) best = s.day;
  return best;
}

export function targetChapter(vols: Volume[], e: StoryEvent): { r: ChRef; why: string } | null {
  const all = allChapters(vols);
  if (!all.length) return null;
  const x = e.ch && all.find((y) => y.ch.id === e.ch);
  if (x) return { r: x, why: "按事件表里填的章节" };
  let best: ChRef | null = null;
  for (const y of all) if (y.ch.scenes.some((s) => s.day && s.day <= e.day)) best = y;
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
export function sceneToEvent(vols: Volume[], events: StoryEvent[], s: Scene, r: ChRef): StoryEvent {
  const e: StoryEvent = { id: uid("e"), day: s.day || guessDay(vols, r), time: s.time || "", ch: r.ch.id, t: s.t, who: s.who.join("、"), ty: s.pay ? "pay" : s.plant ? "plant" : "main", fore: s.pay || s.plant || "", place: s.place || "", result: s.result || "", reveal: s.reveal || "", from: "大纲" };
  if (!s.day) s.day = e.day;
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
    items.push({ key: "A" + id, sec: "A", on: true, lab: `「${e.t}」→ ${chapterFull(t.r)}，新建场景`, why: t.why, run: (x, names) => { const ev = x.events.find((y) => y.id === id); if (ev && !ev.sc) eventToOutline(x.vols, ev, names); } });
  }
  for (const r of all)
    for (const s of r.ch.scenes) {
      if (s.ev) continue;
      const sid = s.id;
      items.push({ key: "B" + sid, sec: "B", on: true, lab: `「${s.t}」→ 第 ${s.day || guessDay(d.vols, r)} 天，新建事件`, why: s.day ? "故事时间取自场景" : "场景没填故事时间，按前后章推断", run: (x) => { const f = findScene(x.vols, sid); if (f && !f.s.ev) sceneToEvent(x.vols, x.events, f.s, f.r); } });
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
  if (untag.length) items.push({ key: "C1", sec: "C", on: true, lab: `给 ${untag.length} 个还没归属的章标上事件段和阶段`, why: all.filter((r) => untag.includes(r.ch.id)).map((r) => `第${r.no}章 ${phaseName(d.plan, where(d.plan, r.no))}`).join("；"), run: tag(untag) });
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
