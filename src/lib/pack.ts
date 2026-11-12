// 作品包：把一本书的全部数据导出成一个文件，换电脑时导入。
import { getDb } from "./db";
import type { Work } from "./types";

export const PACK_TABLES = ["docs", "chapter_text", "chapter_versions", "daily", "memory", "votes", "diary", "chats"] as const;

export interface WorkPack {
  format: "moshu-work";
  version: 1;
  exportedAt: number;
  work: Work;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportPack(work: Work): Promise<WorkPack> {
  const db = await getDb();
  const tables: WorkPack["tables"] = {};
  for (const t of PACK_TABLES) tables[t] = await db.all(`SELECT * FROM ${t} WHERE work_id=?`, [work.id]);
  return { format: "moshu-work", version: 1, exportedAt: Date.now(), work, tables };
}

export function isPack(x: any): x is WorkPack {
  return x && x.format === "moshu-work" && x.work?.id && typeof x.tables === "object";
}

/** 导入作品包。同一本书已经存在时会整本覆盖（调用前要先问作者并备份） */
export async function importPack(p: WorkPack): Promise<void> {
  const db = await getDb();
  const id = p.work.id;
  for (const t of PACK_TABLES) await db.exec(`DELETE FROM ${t} WHERE work_id=?`, [id]);
  await db.exec(`INSERT OR REPLACE INTO works(id, data, updated, deleted) VALUES(?,?,?,0)`, [id, JSON.stringify(p.work), p.work.updated ?? Date.now()]);
  for (const t of PACK_TABLES) {
    const rows = p.tables[t] ?? [];
    if (!rows.length) continue;
    const mine = (await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((x) => x.name);
    for (const r of rows) {
      const cols = mine.filter((c) => c in r);
      if (r.work_id !== id) continue;
      await db.exec(`INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, cols.map((c) => r[c] ?? null));
    }
  }
}

export async function workExists(id: string): Promise<{ deleted: boolean } | null> {
  const db = await getDb();
  const r = await db.all<{ deleted: number }>(`SELECT COALESCE(deleted,0) AS deleted FROM works WHERE id=?`, [id]);
  return r.length ? { deleted: r[0].deleted > 0 } : null;
}
