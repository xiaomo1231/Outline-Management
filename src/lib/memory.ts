// 作品记忆系统：白天投票、夜里结账。
// 脚本班不花 API 费，负责备份、结算票、升降层、对账；模型班调 DeepSeek，负责摘要、日记、常驻页、作品圣经。
import { getDb, isTauri } from "./db";
import * as repo from "./repo";
import type { Character, Id, MemItem, StoryEvent, Volume, Work } from "./types";
import { today, uid } from "./util";
import { allChapters, plants } from "./outline";

export const LAYER = ["", "近期", "中期", "早期", "归档"];
export const RESIDENT_DEFAULT = 3000;

export interface MemLogEntry {
  at: number;
  day: string;
  kind: "script" | "model";
  ok: boolean;
  lines: string[];
}

/* ---------- 投票 ---------- */

export async function voteNew(work: Id, kind: MemItem["kind"], text: string, ch: number, src: string) {
  const db = await getDb();
  await db.exec(`INSERT INTO votes(id, work_id, kind, payload, at) VALUES(?,?,?,?,?)`, [uid("v"), work, "new", JSON.stringify({ kind, text, ch, src }), Date.now()]);
}

export async function voteHit(work: Id, ids: Id[]) {
  if (!ids.length) return;
  const db = await getDb();
  for (const id of ids) await db.exec(`INSERT INTO votes(id, work_id, kind, item_id, at) VALUES(?,?,?,?,?)`, [uid("v"), work, "hit", id, Date.now()]);
}

export async function items(work: Id, layer?: number): Promise<MemItem[]> {
  const db = await getDb();
  return layer ? db.all<MemItem>(`SELECT * FROM memory WHERE work_id=? AND layer=? ORDER BY score DESC`, [work, layer]) : db.all<MemItem>(`SELECT * FROM memory WHERE work_id=? ORDER BY layer, score DESC`, [work]);
}

export async function addItem(work: Id, kind: MemItem["kind"], text: string, ch: number, src: string, layer = 1) {
  const db = await getDb();
  const now = Date.now();
  await db.exec(`INSERT INTO memory(id, work_id, layer, kind, text, short, ch, hits, last_hit, score, created, updated, src) VALUES(?,?,?,?,?,?,?,0,0,0,?,?,?)`, [uid("m"), work, layer, kind, text, shorten(text), ch, now, now, src]);
}

export async function updateItem(id: Id, patch: Partial<Pick<MemItem, "text" | "layer" | "kind">>) {
  const db = await getDb();
  const sets = Object.keys(patch).map((k) => `${k}=?`);
  const vals = Object.values(patch);
  if ("text" in patch) {
    sets.push("short=?");
    vals.push(shorten(patch.text!));
  }
  await db.exec(`UPDATE memory SET ${sets.join(", ")}, updated=? WHERE id=?`, [...vals, Date.now(), id]);
}

/** 越冷的层带越短的版本，原文一直留着 */
export function shorten(t: string): string {
  const first = t.split(/[。！？\n]/)[0];
  return first.length > 40 ? first.slice(0, 40) + "…" : first;
}

export async function pendingVotes(work: Id) {
  const db = await getDb();
  const r = await db.all<{ kind: string; n: number }>(`SELECT kind, COUNT(*) AS n FROM votes WHERE work_id=? AND settled=0 GROUP BY kind`, [work]);
  return { new: r.find((x) => x.kind === "new")?.n ?? 0, hit: r.find((x) => x.kind === "hit")?.n ?? 0 };
}

/* ---------- 分数 ---------- */

/**
 * 确定的分数，不掷骰子：最近命中 + 离当前章节的距离 + 大纲后面是否还会用到。
 * 同样的书稿每次结账结果一致。
 */
export function score(it: MemItem, curNo: number, upcoming: string[], now = Date.now()): number {
  const days = it.last_hit ? (now - it.last_hit) / 86400000 : 999;
  const hitTerm = (it.hits * 3) / (1 + days / 7);
  const dist = Math.max(0, curNo - (it.ch || 0));
  const distTerm = -dist / 10;
  const future = upcoming.some((w) => w.length >= 2 && it.text.includes(w)) ? 5 : 0;
  const kindTerm = it.kind === "decision" || it.kind === "thread" ? 2 : 0;
  return Math.round((hitTerm + distTerm + future + kindTerm + 3) * 100) / 100;
}

export function layerFor(s: number, kind: MemItem["kind"]): number {
  const l = s >= 4 ? 1 : s >= 1.5 ? 2 : s >= -2 ? 3 : 4;
  return kind === "decision" ? Math.min(l, 2) : l;
}

/** 接下来 10 章大纲里会出现的人名、伏笔和场景标题，用来“看未来” */
export function upcomingWords(vols: Volume[], curNo: number): string[] {
  const out = new Set<string>();
  for (const r of allChapters(vols)) {
    if (r.no < curNo || r.no > curNo + 10) continue;
    for (const s of r.ch.scenes) {
      s.who.forEach((w) => out.add(w));
      if (s.plant) out.add(s.plant);
      if (s.pay) out.add(s.pay);
    }
  }
  return [...out];
}

/** 现在写到第几章：最后一个有正文的章 */
export async function currentNo(work: Id, vols: Volume[]): Promise<number> {
  const texts = await repo.allTexts(work);
  const has = new Set(texts.filter((t) => t.words > 0).map((t) => t.id));
  let n = 1;
  for (const r of allChapters(vols)) if (has.has(r.ch.id)) n = r.no;
  return n;
}

/* ---------- 脚本班 ---------- */

let running = false;

export async function scriptRun(work: Work, vols: Volume[]): Promise<MemLogEntry> {
  if (running) return { at: Date.now(), day: today(), kind: "script", ok: false, lines: ["上一次结账还没跑完，这次跳过。"] };
  running = true;
  const lines: string[] = [];
  try {
    const db = await getDb();
    // 1. 备份
    const b = await backup();
    lines.push(b);
    // 2. 结算命中票
    const hits = await db.all<{ item_id: string; n: number }>(`SELECT item_id, COUNT(*) AS n FROM votes WHERE work_id=? AND kind='hit' AND settled=0 GROUP BY item_id`, [work.id]);
    const now = Date.now();
    for (const h of hits) await db.exec(`UPDATE memory SET hits = hits + ?, last_hit=? WHERE id=?`, [h.n, now, h.item_id]);
    // 3. 新条目入层（同样的内容只留一条）
    const before = (await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM memory WHERE work_id=?`, [work.id]))[0].n;
    const news = await db.all<{ payload: string }>(`SELECT payload FROM votes WHERE work_id=? AND kind='new' AND settled=0`, [work.id]);
    const existing = new Set((await db.all<{ text: string }>(`SELECT text FROM memory WHERE work_id=?`, [work.id])).map((x) => x.text));
    let added = 0;
    for (const v of news) {
      const p = JSON.parse(v.payload);
      if (!p.text || existing.has(p.text)) continue;
      existing.add(p.text);
      await addItem(work.id, p.kind, p.text, p.ch, p.src);
      added++;
    }
    await db.exec(`UPDATE votes SET settled=1 WHERE work_id=? AND settled=0`, [work.id]);
    // 4. 各层升降
    const cur = await currentNo(work.id, vols);
    const up = upcomingWords(vols, cur);
    const all = await items(work.id);
    let moved = 0;
    for (const it of all) {
      const s = score(it, cur, up, now);
      const l = layerFor(s, it.kind);
      if (l !== it.layer) moved++;
      await db.exec(`UPDATE memory SET score=?, layer=? WHERE id=?`, [s, l, it.id]);
    }
    // 5. 对账
    const after = (await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM memory WHERE work_id=?`, [work.id]))[0].n;
    const ok = after === before + added;
    const counts = await layerCounts(work.id);
    lines.push(`命中票 ${hits.reduce((a, h) => a + h.n, 0)} 张，新条目 ${news.length} 张，并入 ${added} 条，换层 ${moved} 条。`);
    lines.push(`各层：${counts.map((n, i) => `${LAYER[i + 1]} ${n}`).join("、")}。对账${ok ? "一致" : `不一致（应为 ${before + added}，实为 ${after}）`}。`);
    const e: MemLogEntry = { at: now, day: today(), kind: "script", ok, lines };
    await appendLog(work.id, e);
    return e;
  } catch (err: any) {
    const e: MemLogEntry = { at: Date.now(), day: today(), kind: "script", ok: false, lines: [...lines, "出错：" + (err?.message || err)] };
    await appendLog(work.id, e);
    return e;
  } finally {
    running = false;
  }
}

async function backup(): Promise<string> {
  if (!isTauri) return "浏览器调试版不做文件备份。";
  try {
    const db = await getDb();
    const dir = await db.dir();
    if (!dir) return "找不到数据目录，跳过备份。";
    const { join } = await import("@tauri-apps/api/path");
    const fs = await import("@tauri-apps/plugin-fs");
    const bdir = await join(dir, "backups");
    if (!(await fs.exists(bdir))) await fs.mkdir(bdir, { recursive: true });
    const name = `moshu-${today()}-${Date.now()}.db`;
    const path = await join(bdir, name);
    await db.exec(`VACUUM INTO ?`, [path]);
    // 只留 14 份
    const list = (await fs.readDir(bdir)).filter((e) => e.name?.startsWith("moshu-")).map((e) => e.name!).sort();
    for (const old of list.slice(0, Math.max(0, list.length - 14))) await fs.remove(await join(bdir, old));
    return `已备份数据库（共留 ${Math.min(14, list.length)} 份）。`;
  } catch (e: any) {
    return "备份失败：" + (e?.message || e);
  }
}

export async function layerCounts(work: Id): Promise<number[]> {
  const db = await getDb();
  const r = await db.all<{ layer: number; n: number }>(`SELECT layer, COUNT(*) AS n FROM memory WHERE work_id=? GROUP BY layer`, [work]);
  return [1, 2, 3, 4].map((l) => r.find((x) => x.layer === l)?.n ?? 0);
}

export async function getLog(work: Id): Promise<MemLogEntry[]> {
  return repo.loadDoc<MemLogEntry[]>(work, "memlog", []);
}
export async function appendLog(work: Id, e: MemLogEntry) {
  const log = await getLog(work);
  log.unshift(e);
  await repo.saveDoc(work, "memlog", log.slice(0, 120));
}

/* ---------- 常驻页 ---------- */

export interface Resident {
  text: string;
  at: number;
  limit: number;
}

/**
 * 不调 AI 的常驻页：一半给人物和写作规范，一半给剧情事实。
 * 模型班会在这个基础上压短捋顺。
 */
export function buildResident(work: Work, chars: Character[], vols: Volume[], events: StoryEvent[], styleText: string, facts: MemItem[], limit = RESIDENT_DEFAULT): string {
  const half = Math.floor(limit / 2);
  const people: string[] = [`作品：${work.name}。${work.intro}`];
  if (styleText) people.push("写作规范：" + styleText.replace(/【作者样章[\s\S]*$/, "").slice(0, 500));
  const main = chars.filter((c) => c.name && /男主|女主|男一|女一|反派/.test(c.role));
  const rest = chars.filter((c) => c.name && !main.includes(c));
  for (const c of [...main, ...rest]) {
    const f = c.f;
    const bits = [f.tag, f.id, f.core, f.want].filter(Boolean).join("；");
    people.push(`${c.name}（${c.role}）：${bits}`);
  }
  let a = people.join("\n");
  if (a.length > half) a = a.slice(0, half) + "…";
  const plot: string[] = [];
  const open = plants(vols, events).filter((p) => p.plantNo && !p.payNo);
  if (open.length) plot.push("未收伏笔：" + open.map((p) => `${p.name}（第${p.plantNo}章埋）`).join("；"));
  for (const it of facts.filter((x) => x.layer === 1).sort((x, y) => y.ch - x.ch)) plot.push(`[第${it.ch}章] ${it.text}`);
  let b = plot.join("\n");
  if (b.length > limit - a.length) b = b.slice(0, limit - a.length) + "…";
  return a + "\n\n" + b;
}

export async function getResident(work: Id): Promise<Resident | null> {
  const r = await repo.loadDoc<Resident | null>(work, "resident", null);
  return r && r.text ? r : null;
}
export async function saveResident(work: Id, text: string, limit: number) {
  await repo.saveDoc(work, "resident", { text, at: Date.now(), limit } satisfies Resident);
}

export interface Bible {
  text: string;
  at: number;
}
export async function getBible(work: Id): Promise<Bible> {
  return repo.loadDoc<Bible>(work, "bible", { text: "", at: 0 });
}
export async function saveBible(work: Id, text: string) {
  await repo.saveDoc(work, "bible", { text, at: Date.now() } satisfies Bible);
}

/* ---------- 健康栏 ---------- */

export interface Health {
  counts: number[];
  residentChars: number;
  lastScript: MemLogEntry | undefined;
  lastModel: MemLogEntry | undefined;
  diaryToday: boolean;
  bibleDays: number | null;
  pending: { new: number; hit: number };
  /** 今天该结账但还没结 */
  overdue: boolean;
}

export async function health(work: Id, dailyAt: string): Promise<Health> {
  const [counts, res, log, diary, bible, pending] = await Promise.all([layerCounts(work), getResident(work), getLog(work), repo.getDiary(work, today()), getBible(work), pendingVotes(work)]);
  const lastScript = log.find((e) => e.kind === "script");
  const lastModel = log.find((e) => e.kind === "model");
  const [h, m] = dailyAt.split(":").map(Number);
  const due = new Date();
  due.setHours(h || 22, m || 5, 0, 0);
  const lastDay = lastScript?.day;
  const overdue = (!!lastDay && lastDay < today() && pending.new + pending.hit > 0) || (Date.now() > due.getTime() && lastDay !== today() && pending.new + pending.hit > 0);
  return {
    counts,
    residentChars: res?.text.length ?? 0,
    lastScript,
    lastModel,
    diaryToday: !!diary,
    bibleDays: bible.at ? Math.floor((Date.now() - bible.at) / 86400000) : null,
    pending,
    overdue,
  };
}
