import { getDb } from "./db";
import type { Chat, DocKind, Id, Work } from "./types";
import { today } from "./util";

export async function listWorks(): Promise<Work[]> {
  const db = await getDb();
  const rows = await db.all<{ data: string }>(`SELECT data FROM works ORDER BY updated DESC`);
  return rows.map((r) => JSON.parse(r.data));
}

export async function saveWork(w: Work) {
  const db = await getDb();
  await db.exec(`INSERT OR REPLACE INTO works(id, data, updated) VALUES(?,?,?)`, [w.id, JSON.stringify(w), w.updated]);
}

export async function deleteWork(id: Id) {
  const db = await getDb();
  for (const t of ["docs", "chapter_text", "daily", "memory", "votes", "diary", "chats"]) await db.exec(`DELETE FROM ${t} WHERE work_id=?`, [id]);
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
  return db.all<ChapterText>(`SELECT id, html, plain, words, ai_chars, updated FROM chapter_text WHERE work_id=?`, [work]);
}

/** 保存正文，并把字数变化记到今天的日更里 */
export async function saveText(work: Id, id: Id, html: string, plain: string, words: number, aiChars: number) {
  const db = await getDb();
  const old = await db.all<{ words: number }>(`SELECT words FROM chapter_text WHERE id=?`, [id]);
  const delta = words - (old[0]?.words ?? 0);
  await db.exec(`INSERT OR REPLACE INTO chapter_text(id, work_id, html, plain, words, ai_chars, updated) VALUES(?,?,?,?,?,?,?)`, [id, work, html, plain, words, aiChars, Date.now()]);
  if (delta) {
    await db.exec(`INSERT INTO daily(work_id, day, words) VALUES(?,?,?) ON CONFLICT(work_id, day) DO UPDATE SET words = words + excluded.words`, [work, today(), delta]);
  }
  return delta;
}

export async function deleteText(id: Id) {
  const db = await getDb();
  await db.exec(`DELETE FROM chapter_text WHERE id=?`, [id]);
}

export async function dailyWords(work: Id, days = 30): Promise<{ day: string; words: number }[]> {
  const db = await getDb();
  return db.all(`SELECT day, words FROM daily WHERE work_id=? ORDER BY day DESC LIMIT ?`, [work, days]);
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
