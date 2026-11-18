// 数据库备份与恢复（只在桌面版里有）。备份是整库快照，放在数据目录的 backups 文件夹。
import { getDb, isTauri, type Db } from "./db";
import * as repo from "./repo";
import { fmtTime, today } from "./util";
import { backupTime, backupsToKeep, PULLED_REASON } from "./versions";

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
    await repo.addVersion(work, ch, r.html ?? "", r.plain ?? "", r.words ?? 0, PULLED_REASON, at);
    return true;
  } finally {
    await b.close();
  }
}

const TABLES = ["works", "docs", "chapter_text", "chapter_versions", "daily", "memory", "votes", "diary", "chats", "chapter_archive", "settings", "usage"];

/** has：备份里有没有这张表 */
type TableData = { t: string; cols: string[]; rows: Record<string, unknown>[]; has?: boolean };
type Reader = { all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> };

/** 把备份里每张表（只取现在的库也有的列）整个读出来。备份损坏会在这一步报错，现在的库还没动 */
export async function readTables(src: Reader, db: Db): Promise<TableData[]> {
  const out: TableData[] = [];
  for (const t of TABLES) {
    const mine = ((await db.all<{ name: string }>(`PRAGMA table_info(${t})`)) ?? []).map((x) => x.name);
    if (!mine.length) continue;
    const has = (await src.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t])).length > 0;
    if (!has) {
      out.push({ t, cols: mine, rows: [], has: false });
      continue;
    }
    const theirs = (await src.all(`PRAGMA table_info(${t})`)).map((x) => String(x.name));
    const cols = mine.filter((c) => theirs.includes(c));
    out.push({ t, cols, rows: cols.length ? await src.all(`SELECT ${cols.join(",")} FROM ${t}`) : [], has: true });
  }
  return out;
}

async function writeTables(db: Db, data: TableData[], onStep?: (s: string) => void) {
  for (const { t, cols, rows } of data) {
    onStep?.(`恢复 ${t}……`);
    await db.exec(`DELETE FROM ${t}`);
    if (!cols.length) continue;
    const q = `INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`;
    for (const r of rows) await db.exec(q, cols.map((c) => r[c] ?? null));
  }
}

/** 整库替换的一整段 SQL：挂上备份文件，在一个事务里逐表清空、再从备份整表复制，最后提交。
 *  SQL 插件用的是连接池，分几次调用的 BEGIN…COMMIT 不保证落在同一条连接上，所以必须一次交给数据库执行。
 *  这样中途关窗、进程退出时，SQLite 下次打开会把没提交的事务退回去，库保持原样 */
export function restoreSql(file: string, as: string, data: TableData[]): string {
  const out = [`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS ${as}`, `BEGIN IMMEDIATE`];
  for (const { t, cols, has } of data) {
    out.push(`DELETE FROM main.${t}`);
    // OR ROLLBACK：备份里有坏行（必填值为空等）时整个事务立刻退回，不会留下没结束的事务
    if (has !== false && cols.length) out.push(`INSERT OR ROLLBACK INTO main.${t}(${cols.join(",")}) SELECT ${cols.join(",")} FROM ${as}.${t}`);
  }
  out.push(`COMMIT`, `DETACH DATABASE ${as}`);
  return out.join(";\n");
}

/** 在一个事务里把整库换成备份文件的内容，换完核对每张表的行数 */
async function swapInTx(db: Db, file: string, data: TableData[]) {
  const as = "bk" + Date.now().toString(36);
  try {
    await db.exec(restoreSql(file, as, data));
  } catch (e) {
    // 出错的那条连接上可能还留着没结束的事务和挂着的备份。连接池轮流给出空闲连接，多试几次总能轮到它
    for (let i = 0; i < 12; i++) await db.exec(`ROLLBACK`).catch(() => {});
    for (let i = 0; i < 12; i++) await db.exec(`DETACH DATABASE ${as}`).catch(() => {});
    throw e;
  }
  for (const { t, cols, rows, has } of data) {
    const n = Number((await db.all<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))[0]?.n ?? 0);
    const want = has !== false && cols.length ? rows.length : 0;
    if (n !== want) throw new Error(`${t} 恢复后有 ${n} 行，备份里是 ${want} 行`);
  }
}

/** 恢复中途出错。dirty 表示没能退回原样，库里可能一半新一半旧 */
export class RestoreError extends Error {
  constructor(msg: string, public dirty: boolean) {
    super(msg);
  }
}

/** 用读好的备份数据替换现在的库。给了 file（备份文件路径）就在一个事务里整库替换；
 *  中途出错时把恢复前的数据写回去，做到要么全换、要么不动 */
export async function replaceTables(db: Db, data: TableData[], onStep?: (s: string) => void, pre = "", file?: string): Promise<void> {
  // 先把现在的库整个记下来，出错时退回
  const old = await readTables(db, db);
  try {
    if (file) {
      onStep?.("替换数据……");
      await swapInTx(db, file, data);
    } else await writeTables(db, data, onStep);
  } catch (e: any) {
    const why = e?.message || String(e);
    onStep?.("恢复出错，正在退回恢复前的数据……");
    try {
      // 事务已经整个退回时库和恢复前一模一样，不用再写
      if (JSON.stringify(await readTables(db, db)) !== JSON.stringify(old)) await writeTables(db, old);
    } catch {
      throw new RestoreError(`恢复中途出错（${why}），也没能退回原样。请到「备份与恢复」里整库恢复${pre ? ` ${pre} 的` : "最上面"}那份（恢复前自动备份的）。`, true);
    }
    throw new RestoreError(`恢复中途出错（${why}），已退回恢复前的数据，什么都没改。`, false);
  }
}

let busy: Promise<void> | null = null;
/** 正在整库恢复、或恢复完正等重新加载时返回它。这期间界面手里是恢复前的旧数据，不能再写库 */
export const restoring = () => busy;

/** 整库恢复：先给现在的库备份一份，把备份整个读出来，再在一个事务里替换每张表。之后要重新加载页面 */
export function restoreAll(name: string, onStep?: (s: string) => void): Promise<void> {
  const p = doRestore(name, onStep);
  busy = p;
  // 失败但库没动时，界面的数据还能接着用
  p.catch((e) => {
    if (!(e instanceof RestoreError && e.dirty) && busy === p) busy = null;
  });
  return p;
}

async function doRestore(name: string, onStep?: (s: string) => void): Promise<void> {
  onStep?.("先给现在的数据备份一份……");
  const pre = await backup({ prune: false });
  if (pre.startsWith("备份失败")) throw new Error("恢复前的备份没成功，停止恢复：" + pre);
  const latest = (await listBackups())[0];
  const db = await getDb();
  onStep?.("读取备份……");
  const b = await openBackup(name);
  let data: TableData[];
  try {
    data = await readTables({ all: async (sql, params) => (await b.select(sql, params)) as Record<string, unknown>[] }, db);
  } catch (e: any) {
    throw new Error("这份备份读不出来，现在的数据没有动：" + (e?.message || e));
  } finally {
    await b.close();
  }
  const { join } = await import("@tauri-apps/api/path");
  const bdir = await backupDir();
  await replaceTables(db, data, onStep, latest ? fmtTime(latest.at) : "", bdir ? await join(bdir, name) : undefined);
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
