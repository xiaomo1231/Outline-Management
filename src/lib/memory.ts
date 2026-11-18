// 作品记忆系统：白天投票、夜里每日整理。
// 自动整理不花 API 费，负责备份、结算票、升降层、对账；AI 整理调 DeepSeek，负责摘要、日记、核心摘要、设定集。
import { getDb } from "./db";
import { backup } from "./backup";
import { purgeOld } from "./trash";
import * as repo from "./repo";
import type { Character, Id, MemItem, StoryEvent, Volume, Work } from "./types";
import { today, uid } from "./util";
import { allChapters, plants } from "./outline";

export const LAYER = ["", "近期", "中期", "早期", "归档"];
export const RESIDENT_DEFAULT = 10000;

export interface MemLogEntry {
  at: number;
  day: string;
  kind: "script" | "model";
  ok: boolean;
  lines: string[];
  /** 每日整理结的是哪一天的账；关窗、「只跑自动整理」、归档后顺带跑的不算结账，记成空串（老日志没有这一项，按结过账算） */
  daily?: string;
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

/** 章节归档写进来的事实：src 记成「归档:章id」，重新归档时整组替换，内容没变的旧条目连同命中次数保留 */
export async function replaceChapterFacts(work: Id, chId: Id, no: number, facts: string[]) {
  const db = await getDb();
  const src = "归档:" + chId;
  const old = await db.all<MemItem>(`SELECT * FROM memory WHERE work_id=? AND src=?`, [work, src]);
  const keep = new Set(old.filter((x) => facts.includes(x.text)).map((x) => x.text));
  for (const x of old) if (!keep.has(x.text)) await db.exec(`DELETE FROM memory WHERE id=?`, [x.id]);
  const existing = new Set((await db.all<{ text: string }>(`SELECT text FROM memory WHERE work_id=?`, [work])).map((x) => x.text));
  for (const f of facts) if (!existing.has(f)) {
    existing.add(f);
    await addItem(work, "fact", f, no, src);
  }
  // 章号可能因为插章变了，顺手更新
  await db.exec(`UPDATE memory SET ch=? WHERE work_id=? AND src=?`, [no, work, src]);
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
  // 取第一个不为空的句子：以标点开头时第一句是空串
  const first = t.split(/[。！？\n]/).find((x) => x.trim()) ?? t.trim();
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
 * 同样的书稿每次每日整理结果一致。
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

/* ---------- 自动整理 ---------- */

let running = false;

/** daily：到点的每日整理（或手动「现在整理」）结的是哪一天的账；其他时候顺带跑的不传 */
export async function scriptRun(work: Work, vols: Volume[], daily = ""): Promise<MemLogEntry> {
  if (running) return { at: Date.now(), day: today(), kind: "script", ok: false, lines: ["上一次每日整理还没跑完，这次跳过。"], daily: "" };
  running = true;
  const lines: string[] = [];
  try {
    const db = await getDb();
    // 1. 备份，顺带清理旧快照和回收站
    const b = await backup();
    lines.push(b);
    try {
      const pv = await repo.pruneVersions(work.id);
      const pt = await purgeOld();
      if (pv || pt) lines.push(`清理了 ${pv} 份旧的章节快照${pt ? `，回收站里 ${pt} 项超过 30 天，已彻底删除` : ""}。`);
    } catch (e: any) {
      lines.push("清理旧快照出错：" + (e?.message || e));
    }
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
      // 老版本以标点开头的条目短版本是空的，顺手补上
      if (!(it.short || "").trim()) await db.exec(`UPDATE memory SET short=? WHERE id=?`, [shorten(it.text), it.id]);
    }
    // 5. 对账
    const after = (await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM memory WHERE work_id=?`, [work.id]))[0].n;
    const ok = after === before + added;
    const counts = await layerCounts(work.id);
    lines.push(`命中 ${hits.reduce((a, h) => a + h.n, 0)} 次，新条目 ${news.length} 条，并入 ${added} 条，换层 ${moved} 条。`);
    lines.push(`各层：${counts.map((n, i) => `${LAYER[i + 1]} ${n}`).join("、")}。对账${ok ? "一致" : `不一致（应为 ${before + added}，实为 ${after}）`}。`);
    const e: MemLogEntry = { at: now, day: today(), kind: "script", ok, lines, daily };
    await appendLog(work.id, e);
    return e;
  } catch (err: any) {
    const e: MemLogEntry = { at: Date.now(), day: today(), kind: "script", ok: false, lines: [...lines, "出错：" + (err?.message || err)], daily };
    await appendLog(work.id, e);
    return e;
  } finally {
    running = false;
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

/* ---------- 核心摘要 ---------- */

export interface Resident {
  text: string;
  at: number;
  limit: number;
  /** 拼这份摘要时的写作规范指纹（styleSig）。老数据和作者手写的没有 */
  style?: string;
}

/** 写进核心摘要的那段写作规范（去掉样章）的指纹：风格或「我的规则」改了就对不上 */
export function styleSig(styleText: string): string {
  const t = styleText.replace(/【作者样章[\s\S]*$/, "");
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
  return t.length + ":" + (h >>> 0).toString(36);
}

/**
 * 不调 AI 的核心摘要：一半给人物和写作规范，一半给剧情事实。
 * AI 整理会在这个基础上压短捋顺。
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
export async function saveResident(work: Id, text: string, limit: number, style?: string) {
  await repo.saveDoc(work, "resident", { text, at: Date.now(), limit, ...(style ? { style } : {}) } satisfies Resident);
}

export interface Bible {
  text: string;
  at: number;
  /** AI 整理提炼到哪个时间点的归档；作者手动保存不动它（老数据没有，用 at） */
  upto?: number;
}
export async function getBible(work: Id): Promise<Bible> {
  return repo.loadDoc<Bible>(work, "bible", { text: "", at: 0 });
}
/** upto 只有 AI 整理提炼后才传；作者手动保存时沿用原来的 */
export async function saveBible(work: Id, text: string, upto?: number) {
  const old = await getBible(work);
  await repo.saveDoc(work, "bible", { text, at: Date.now(), upto: upto ?? old.upto ?? old.at } satisfies Bible);
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
  /** 到点了（或漏跑了）还没结账，而且上次结账后写过东西或有待整理票 */
  overdue: boolean;
  /** 现在该结哪一天的账：漏跑时是漏掉的那天，否则是今天 */
  owe: string;
}

/** 最近一次结账：关窗等顺带跑的自动整理不算 */
export function lastDaily(log: MemLogEntry[]): MemLogEntry | undefined {
  return log.find((e) => e.kind === "script" && e.daily !== "");
}

/** 最近一个已经过了的整理时刻。dailyAt 形如 "22:05"，读不出来按 22:05 */
export function lastDue(dailyAt: string, now = Date.now()): Date {
  // 不能用 || 给默认值：0 点、整点的 0 会被当成没填
  const t = /^(\d{1,2}):(\d{1,2})/.exec(dailyAt || "");
  const due = new Date(now);
  due.setHours(t ? +t[1] : 22, t ? +t[2] : 5, 0, 0);
  if (due.getTime() > now) due.setDate(due.getDate() - 1);
  return due;
}

/**
 * 该不该结账。last：最近一次结账；edited：正文最后保存时间；votes：待整理票数。
 * 从没结过账时：今天到点了，或者上一个整理时刻之前就写过东西（漏跑）才算欠账，不在新书第一天早上补“昨天”。
 */
export function owing(dailyAt: string, last: MemLogEntry | undefined, edited: number, votes: number, now = Date.now()): { overdue: boolean; owe: string } {
  const due = lastDue(dailyAt, now);
  const owed = last ? last.at < due.getTime() : today(due) === today(new Date(now)) || (edited > 0 && edited < due.getTime());
  const active = votes > 0 || edited > (last?.at ?? 0);
  return { overdue: owed && active, owe: owed ? today(due) : today(new Date(now)) };
}

async function lastEdited(work: Id): Promise<number> {
  const db = await getDb();
  const r = await db.all<{ t: number | null }>(`SELECT MAX(updated) AS t FROM chapter_text WHERE work_id=?`, [work]);
  return r[0]?.t ?? 0;
}

export async function health(work: Id, dailyAt: string): Promise<Health> {
  const [counts, res, log, diary, bible, pending, edited] = await Promise.all([layerCounts(work), getResident(work), getLog(work), repo.getDiary(work, today()), getBible(work), pendingVotes(work), lastEdited(work)]);
  const lastScript = log.find((e) => e.kind === "script");
  const lastModel = log.find((e) => e.kind === "model");
  // 「今天跑过」只认结账那次；没有待整理票时，写过东西也要结账（备份、日记、补归档）
  const { overdue, owe } = owing(dailyAt, lastDaily(log), edited, pending.new + pending.hit);
  return {
    counts,
    residentChars: res?.text.length ?? 0,
    lastScript,
    lastModel,
    diaryToday: !!diary,
    bibleDays: bible.at ? Math.floor((Date.now() - bible.at) / 86400000) : null,
    pending,
    overdue,
    owe,
  };
}
