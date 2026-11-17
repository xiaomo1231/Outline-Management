import { getDb } from "./db";
import type { Chat, DocKind, Id, Work } from "./types";
import { today, uid } from "./util";
import { keepVersions } from "./versions";

export async function listWorks(): Promise<Work[]> {
  const db = await getDb();
  const rows = await db.all<{ data: string }>(`SELECT data FROM works WHERE COALESCE(deleted,0)=0 ORDER BY updated DESC`);
  return rows.map((r) => JSON.parse(r.data));
}

/** 回收站里的作品，带删除时间 */
export async function listDeletedWorks(): Promise<{ work: Work; at: number }[]> {
  const db = await getDb();
  const rows = await db.all<{ data: string; deleted: number }>(`SELECT data, deleted FROM works WHERE COALESCE(deleted,0)>0 ORDER BY deleted DESC`);
  return rows.map((r) => ({ work: JSON.parse(r.data), at: r.deleted }));
}

/** 删书先进回收站，30 天后才真删 */
export async function softDeleteWork(id: Id) {
  const db = await getDb();
  await db.exec(`UPDATE works SET deleted=? WHERE id=?`, [Date.now(), id]);
}
export async function restoreWork(id: Id) {
  const db = await getDb();
  await db.exec(`UPDATE works SET deleted=0 WHERE id=?`, [id]);
}

export async function saveWork(w: Work) {
  const db = await getDb();
  await db.exec(`INSERT OR REPLACE INTO works(id, data, updated) VALUES(?,?,?)`, [w.id, JSON.stringify(w), w.updated]);
}

export async function deleteWork(id: Id) {
  const db = await getDb();
  for (const t of ["docs", "chapter_text", "chapter_versions", "daily", "memory", "votes", "diary", "chats"]) await db.exec(`DELETE FROM ${t} WHERE work_id=?`, [id]);
  await db.exec(`DELETE FROM works WHERE id=?`, [id]);
}

export async function loadDoc<T>(work: Id, kind: DocKind, fallback: T): Promise<T> {
  const db = await getDb();
  const r = await db.all<{ data: string }>(`SELECT data FROM docs WHERE work_id=? AND kind=?`, [work, kind]);
  return r.length ? (JSON.parse(r[0].data) as T) : fallback;
}

export async function saveDoc(work: Id, kind: DocKind, data: unknown) {
  const db = await getDb();
  await db.exec(`INSERT OR REPLACE INTO docs(work_id, kind, data, updated) VALUES(?,?,?,?)`, [work, kind, JSON.stringify(data), Date.now()]);
}

export interface ChapterText {
  id: Id;
  html: string;
  plain: string;
  words: number;
  ai_chars: number;
  updated: number;
}

export async function loadText(id: Id): Promise<ChapterText | null> {
  const db = await getDb();
  const r = await db.all<ChapterText>(`SELECT id, html, plain, words, ai_chars, updated FROM chapter_text WHERE id=?`, [id]);
  return r[0] ?? null;
}

export async function allTexts(work: Id): Promise<ChapterText[]> {
  const db = await getDb();
  return db.all<ChapterText>(`SELECT id, html, plain, words, ai_chars, updated FROM chapter_text WHERE work_id=? AND COALESCE(deleted,0)=0`, [work]);
}

/** 保存正文，并把字数变化记到今天的日更里 */
export async function saveText(work: Id, id: Id, html: string, plain: string, words: number, aiChars: number) {
  const db = await getDb();
  const old = await db.all<{ words: number }>(`SELECT words FROM chapter_text WHERE id=?`, [id]);
  const delta = words - (old[0]?.words ?? 0);
  await db.exec(`INSERT OR REPLACE INTO chapter_text(id, work_id, html, plain, words, ai_chars, updated, deleted) VALUES(?,?,?,?,?,?,?,0)`, [id, work, html, plain, words, aiChars, Date.now()]);
  if (delta) {
    await db.exec(`INSERT INTO daily(work_id, day, words) VALUES(?,?,?) ON CONFLICT(work_id, day) DO UPDATE SET words = words + excluded.words`, [work, today(), delta]);
  }
  return delta;
}

export async function deleteText(id: Id) {
  const db = await getDb();
  await db.exec(`DELETE FROM chapter_text WHERE id=?`, [id]);
  await db.exec(`DELETE FROM chapter_versions WHERE chapter_id=?`, [id]);
}

/** 删章时正文只做标记，回收站可以恢复 */
export async function markTextDeleted(id: Id, deleted: boolean) {
  const db = await getDb();
  await db.exec(`UPDATE chapter_text SET deleted=? WHERE id=?`, [deleted ? 1 : 0, id]);
}

/* ---------- 章节版本 ---------- */

export interface Version {
  id: Id;
  chapter_id: Id;
  at: number;
  words: number;
  reason: string;
}
export interface VersionFull extends Version {
  html: string;
  plain: string;
}

export async function addVersion(work: Id, ch: Id, html: string, plain: string, words: number, reason: string, at = Date.now()) {
  const db = await getDb();
  await db.exec(`INSERT INTO chapter_versions(id, chapter_id, work_id, html, plain, words, at, reason) VALUES(?,?,?,?,?,?,?,?)`, [uid("ver"), ch, work, html, plain, words, at, reason]);
}
export async function listVersions(ch: Id): Promise<Version[]> {
  const db = await getDb();
  return db.all<Version>(`SELECT id, chapter_id, at, words, reason FROM chapter_versions WHERE chapter_id=? ORDER BY at DESC`, [ch]);
}
export async function getVersion(id: Id): Promise<VersionFull | null> {
  const db = await getDb();
  return (await db.all<VersionFull>(`SELECT * FROM chapter_versions WHERE id=?`, [id]))[0] ?? null;
}
export async function latestVersion(ch: Id): Promise<VersionFull | null> {
  const db = await getDb();
  return (await db.all<VersionFull>(`SELECT * FROM chapter_versions WHERE chapter_id=? ORDER BY at DESC LIMIT 1`, [ch]))[0] ?? null;
}
/** 按保留规则清理一本书的旧快照，返回删掉的份数 */
export async function pruneVersions(work: Id, now = Date.now()): Promise<number> {
  const db = await getDb();
  const rows = await db.all<{ id: string; chapter_id: string; at: number }>(`SELECT id, chapter_id, at FROM chapter_versions WHERE work_id=?`, [work]);
  const by = new Map<string, { id: string; at: number }[]>();
  for (const r of rows) (by.get(r.chapter_id) ?? by.set(r.chapter_id, []).get(r.chapter_id)!).push(r);
  let n = 0;
  for (const list of by.values()) {
    const keep = keepVersions(list, now);
    for (const v of list) {
      if (keep.has(v.id)) continue;
      await db.exec(`DELETE FROM chapter_versions WHERE id=?`, [v.id]);
      n++;
    }
  }
  return n;
}

export async function dailyWords(work: Id, days = 30): Promise<{ day: string; words: number; pasted: number; ai: number }[]> {
  const db = await getDb();
  return db.all(`SELECT day, words, COALESCE(pasted,0) AS pasted, COALESCE(ai,0) AS ai FROM daily WHERE work_id=? ORDER BY day DESC LIMIT ?`, [work, days]);
}

/** 记下今天粘贴进来的字数和 AI 写进正文的字数，日更里单列 */
export async function addDailyExtra(work: Id, kind: "pasted" | "ai", n: number) {
  if (!n) return;
  const db = await getDb();
  await db.exec(`INSERT INTO daily(work_id, day, words, ${kind}) VALUES(?,?,0,?) ON CONFLICT(work_id, day) DO UPDATE SET ${kind} = COALESCE(${kind},0) + excluded.${kind}`, [work, today(), n]);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const r = await db.all<{ value: string }>(`SELECT value FROM settings WHERE key=?`, [key]);
  return r.length ? (JSON.parse(r[0].value) as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  const db = await getDb();
  await db.exec(`INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)`, [key, JSON.stringify(value)]);
}

export async function addUsage(prompt: number, cached: number, completion: number) {
  const db = await getDb();
  await db.exec(
    `INSERT INTO usage(day, prompt, cached, completion, calls) VALUES(?,?,?,?,1) ON CONFLICT(day) DO UPDATE SET prompt=prompt+excluded.prompt, cached=cached+excluded.cached, completion=completion+excluded.completion, calls=calls+1`,
    [today(), prompt, cached, completion],
  );
}
export async function getUsage(days = 30) {
  const db = await getDb();
  return db.all<{ day: string; prompt: number; cached: number; completion: number; calls: number }>(`SELECT * FROM usage ORDER BY day DESC LIMIT ?`, [days]);
}

export async function listChats(work: Id): Promise<Chat[]> {
  const db = await getDb();
  const r = await db.all<{ id: string; title: string; msgs: string; updated: number }>(`SELECT * FROM chats WHERE work_id=? ORDER BY updated DESC`, [work]);
  return r.map((x) => ({ id: x.id, title: x.title, msgs: JSON.parse(x.msgs || "[]"), updated: x.updated }));
}
export async function saveChat(work: Id, c: Chat) {
  const db = await getDb();
  await db.exec(`INSERT OR REPLACE INTO chats(id, work_id, title, msgs, updated) VALUES(?,?,?,?,?)`, [c.id, work, c.title, JSON.stringify(c.msgs), c.updated]);
}
export async function deleteChat(id: Id) {
  const db = await getDb();
  await db.exec(`DELETE FROM chats WHERE id=?`, [id]);
}

export async function getDiary(work: Id, day: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.all<{ text: string }>(`SELECT text FROM diary WHERE work_id=? AND day=?`, [work, day]);
  return r[0]?.text ?? null;
}
export async function listDiary(work: Id, n = 30) {
  const db = await getDb();
  return db.all<{ day: string; text: string }>(`SELECT day, text FROM diary WHERE work_id=? ORDER BY day DESC LIMIT ?`, [work, n]);
}
export async function saveDiary(work: Id, day: string, text: string) {
  const db = await getDb();
  await db.exec(`INSERT OR REPLACE INTO diary(work_id, day, text) VALUES(?,?,?)`, [work, day, text]);
}
