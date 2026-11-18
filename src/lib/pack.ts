// 作品包：把一本书的全部数据导出成一个文件，换电脑时导入。
import { getDb } from "./db";
import type { Work } from "./types";
import { cleanHtml } from "./util";

/** 这些表里的 html 列是正文，导入外来的包时要清洗，免得夹带脚本 */
const HTML_TABLES = new Set<string>(["chapter_text", "chapter_versions"]);

export const PACK_TABLES = ["docs", "chapter_text", "chapter_versions", "daily", "memory", "votes", "diary", "chats", "chapter_archive"] as const;

export interface WorkPack {
  format: "moshu-work";
  version: 1;
  exportedAt: number;
  work: Work;
  tables: Record<string, Record<string, unknown>[]>;
  /** 上次写到的章 id，换电脑后接着写这章 */
  lastChapter?: string;
}

export async function exportPack(work: Work): Promise<WorkPack> {
  const db = await getDb();
  const tables: WorkPack["tables"] = {};
  for (const t of PACK_TABLES) tables[t] = await db.all(`SELECT * FROM ${t} WHERE work_id=?`, [work.id]);
  const last = await db.all<{ value: string }>(`SELECT value FROM settings WHERE key=?`, ["lastChapter:" + work.id]);
  const lastChapter = last.length ? (JSON.parse(last[0].value) as string | null) ?? undefined : undefined;
  return { format: "moshu-work", version: 1, exportedAt: Date.now(), work, tables, lastChapter };
}

/** 认出作品包；work 缺字段（手改或损坏的包）时补上默认值，免得界面报错 */
export function isPack(x: any): x is WorkPack {
  if (!(x && x.format === "moshu-work" && x.work && typeof x.work.id === "string" && x.work.id && x.tables && typeof x.tables === "object")) return false;
  const w = x.work;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const now = Date.now();
  x.work = {
    ...w,
    name: typeof w.name === "string" && w.name.trim() ? w.name : "导入的作品",
    intro: typeof w.intro === "string" ? w.intro : "",
    goal: Math.max(100, num(w.goal, 2000)),
    chapWords: Math.max(500, num(w.chapWords, 2500)),
    created: num(w.created, now),
    updated: num(w.updated, now),
  };
  return true;
}

/** 导入作品包。同一本书已经存在时会整本覆盖（调用前要先问作者并备份） */
export async function importPack(p: WorkPack): Promise<void> {
  const db = await getDb();
  const id = p.work.id;
  for (const t of PACK_TABLES) await db.exec(`DELETE FROM ${t} WHERE work_id=?`, [id]);
  await db.exec(`INSERT OR REPLACE INTO works(id, data, updated, deleted) VALUES(?,?,?,0)`, [id, JSON.stringify(p.work), p.work.updated ?? Date.now()]);
  for (const t of PACK_TABLES) {
    const rows = Array.isArray(p.tables[t]) ? p.tables[t] : [];
    if (!rows.length) continue;
    const mine = (await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((x) => x.name);
    for (const r of rows) {
      if (!r || typeof r !== "object" || r.work_id !== id) continue;
      const cols = mine.filter((c) => c in r);
      if (HTML_TABLES.has(t) && typeof r.html === "string") r.html = cleanHtml(r.html);
      await db.exec(`INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, cols.map((c) => r[c] ?? null));
    }
  }
  if (typeof p.lastChapter === "string") await db.exec(`INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)`, ["lastChapter:" + id, JSON.stringify(p.lastChapter)]);
}

export async function workExists(id: string): Promise<{ deleted: boolean } | null> {
  const db = await getDb();
  const r = await db.all<{ deleted: number }>(`SELECT COALESCE(deleted,0) AS deleted FROM works WHERE id=?`, [id]);
  return r.length ? { deleted: r[0].deleted > 0 } : null;
}
