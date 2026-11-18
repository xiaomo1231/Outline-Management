// 数据库备份与恢复（只在桌面版里有）。备份是整库快照，放在数据目录的 backups 文件夹。
import { getDb, isTauri } from "./db";
import * as repo from "./repo";
import { today } from "./util";
import { backupTime, backupsToKeep } from "./versions";

export const BACKUP_EVERY = 2 * 3600_000;

/** 作者另选的第二备份目录（例如网盘同步目录），每次备份后复制一份过去 */
export async function getSecondDir(): Promise<string> {
  return repo.getSetting<string>("backupDir2", "");
}
export async function setSecondDir(dir: string) {
  await repo.setSetting("backupDir2", dir);
}

async function backupDir(): Promise<string | null> {
  const dir = await (await getDb()).dir();
  if (!dir) return null;
  const { join } = await import("@tauri-apps/api/path");
  return join(dir, "backups");
}

async function prune(dir: string) {
  const fs = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  const names = (await fs.readDir(dir)).map((e) => e.name ?? "").filter((n) => backupTime(n) != null);
  const keep = backupsToKeep(names);
  for (const n of names) if (!keep.has(n)) await fs.remove(await join(dir, n));
  return keep.size;
}

/** 立刻备份一份。返回一句给作者看的话 */
export async function backup(opts: { prune?: boolean } = {}): Promise<string> {
  if (!isTauri) return "浏览器调试版不做文件备份。";
  try {
    const db = await getDb();
    const bdir = await backupDir();
    if (!bdir) return "找不到数据目录，跳过备份。";
    const { join } = await import("@tauri-apps/api/path");
    const fs = await import("@tauri-apps/plugin-fs");
    if (!(await fs.exists(bdir))) await fs.mkdir(bdir, { recursive: true });
    const name = `moshu-${today()}-${Date.now()}.db`;
    const path = await join(bdir, name);
    await db.exec(`VACUUM INTO ?`, [path]);
    const n = opts.prune === false ? (await fs.readDir(bdir)).length : await prune(bdir);
    await repo.setSetting("lastBackup", Date.now());
    let extra = "";
    const dir2 = await getSecondDir();
    if (dir2) {
      try {
        await fs.copyFile(path, await join(dir2, name));
        if (opts.prune !== false) await prune(dir2);
        extra = "，第二备份目录也复制了一份";
      } catch (e: any) {
        extra = "，但复制到第二备份目录失败：" + (e?.message || e);
      }
    }
    return `已备份数据库（共留 ${n} 份${extra}）。`;
  } catch (e: any) {
    return "备份失败：" + (e?.message || e);
  }
}

export interface BackupFile {
  name: string;
  at: number;
  size: number | null;
}

export async function listBackups(): Promise<BackupFile[]> {
  if (!isTauri) return [];
  const bdir = await backupDir();
  if (!bdir) return [];
  const fs = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  if (!(await fs.exists(bdir))) return [];
  const out: BackupFile[] = [];
  for (const e of await fs.readDir(bdir)) {
    const at = e.name ? backupTime(e.name) : null;
    if (!e.name || at == null) continue;
    let size: number | null = null;
    try {
      size = (await fs.stat(await join(bdir, e.name))).size;
    } catch {
      size = null;
    }
    out.push({ name: e.name, at, size });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** 打开一份备份（只读用），用完要 close */
async function openBackup(name: string) {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  // 插件把相对路径放在应用配置目录下，备份就在那里的 backups 文件夹
  return Database.load(`sqlite:backups/${name}`);
}

/** 这份备份里，某本书各章的字数；title 是备份时大纲里的章名，已经删掉的章靠它认 */
export async function chaptersInBackup(name: string, work: string): Promise<{ id: string; words: number; updated: number; title?: string }[]> {
  const b = await openBackup(name);
  try {
    const rows = (await b.select(`SELECT id, words, updated FROM chapter_text WHERE work_id=?`, [work])) as { id: string; words: number; updated: number }[];
    const titles = new Map<string, string>();
    try {
      const doc = ((await b.select(`SELECT data FROM docs WHERE work_id=? AND kind='outline'`, [work])) as { data: string }[])[0];
      for (const v of JSON.parse(doc?.data ?? "[]")) for (const c of v.chapters ?? []) titles.set(c.id, c.title || "");
    } catch {
      /* 备份里的大纲读不出来，就只认还在书里的章 */
    }
    return rows.map((r) => ({ ...r, title: titles.get(r.id) }));
  } finally {
    await b.close();
  }
}

/** 取回一章已经彻底删除的：把备份里的正文写回库里（不记进今日字数），由调用方放回大纲。返回出错原因，成功返回空串 */
export async function restoreDeletedChapter(name: string, work: string, ch: string): Promise<string> {
  const db = await getDb();
  const cur = await db.all<{ deleted: number | null }>(`SELECT deleted FROM chapter_text WHERE id=?`, [ch]);
  if (cur.some((x) => x.deleted)) return "这一章还在回收站里，到「回收站」里恢复就行";
  if (cur.length) return "";
  const b = await openBackup(name);
  try {
    const r = ((await b.select(`SELECT html, plain, words, ai_chars FROM chapter_text WHERE id=?`, [ch])) as any[])[0];
    if (!r) return "这份备份里没有这一章的正文";
    await db.exec(`INSERT INTO chapter_text(id, work_id, html, plain, words, ai_chars, updated, deleted) VALUES(?,?,?,?,?,?,?,0)`, [ch, work, r.html ?? "", r.plain ?? "", r.words ?? 0, r.ai_chars ?? 0, Date.now()]);
    return "";
  } finally {
    await b.close();
  }
}

/** 从备份里取回一章：存成这一章的一份历史版本，作者在「历史」里对比后决定要不要用 */
export async function pullChapter(name: string, work: string, ch: string): Promise<boolean> {
  const b = await openBackup(name);
  try {
    const r = ((await b.select(`SELECT html, plain, words FROM chapter_text WHERE id=?`, [ch])) as any[])[0];
    if (!r) return false;
    const at = backupTime(name) ?? Date.now();
    await repo.addVersion(work, ch, r.html ?? "", r.plain ?? "", r.words ?? 0, "从备份取回", at);
    return true;
  } finally {
    await b.close();
  }
}

const TABLES = ["works", "docs", "chapter_text", "chapter_versions", "daily", "memory", "votes", "diary", "chats", "chapter_archive", "settings", "usage"];

/** 整库恢复：先给现在的库备份一份，再把备份里的每张表抄回来。之后要重新加载页面 */
export async function restoreAll(name: string, onStep?: (s: string) => void): Promise<void> {
  onStep?.("先给现在的数据备份一份……");
  const pre = await backup({ prune: false });
  if (pre.startsWith("备份失败")) throw new Error("恢复前的备份没成功，停止恢复：" + pre);
  const db = await getDb();
  const b = await openBackup(name);
  try {
    for (const t of TABLES) {
      const has = ((await b.select(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t])) as any[]).length > 0;
      const mine = ((await db.all<{ name: string }>(`PRAGMA table_info(${t})`)) ?? []).map((x) => x.name);
      onStep?.(`恢复 ${t}……`);
      await db.exec(`DELETE FROM ${t}`);
      if (!has) continue;
      const theirs = ((await b.select(`PRAGMA table_info(${t})`)) as { name: string }[]).map((x) => x.name);
      const cols = mine.filter((c) => theirs.includes(c));
      const rows = (await b.select(`SELECT ${cols.join(",")} FROM ${t}`)) as Record<string, unknown>[];
      const q = `INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`;
      for (const r of rows) await db.exec(q, cols.map((c) => r[c] ?? null));
    }
  } finally {
    await b.close();
  }
}

/** 启动时检查数据库是否完好。返回 null 表示没问题 */
export async function checkIntegrity(): Promise<string | null> {
  try {
    const db = await getDb();
    const r = await db.all<Record<string, string>>(`PRAGMA quick_check`);
    const v = r.map((x) => Object.values(x)[0]).join("；");
    return v === "ok" ? null : v;
  } catch (e: any) {
    return String(e?.message || e);
  }
}
