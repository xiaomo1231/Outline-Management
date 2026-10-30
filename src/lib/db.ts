// 数据库适配层。桌面版用 Tauri 的 SQLite 插件；在浏览器里打开（开发调试）时用 sql.js，数据存在 IndexedDB。
// 两边都用 ? 占位符，上层代码不需要知道跑在哪里。

export type Row = Record<string, any>;
export interface Db {
  exec(sql: string, params?: unknown[]): Promise<void>;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 桌面版返回数据库文件所在目录，浏览器版返回 null */
  dir(): Promise<string | null>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS docs(work_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER, PRIMARY KEY(work_id, kind))`,
  `CREATE TABLE IF NOT EXISTS chapter_text(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, html TEXT, plain TEXT, words INTEGER DEFAULT 0, ai_chars INTEGER DEFAULT 0, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS daily(work_id TEXT NOT NULL, day TEXT NOT NULL, words INTEGER DEFAULT 0, PRIMARY KEY(work_id, day))`,
  `CREATE TABLE IF NOT EXISTS memory(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, layer INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, short TEXT, ch INTEGER, hits INTEGER DEFAULT 0, last_hit INTEGER DEFAULT 0, score REAL DEFAULT 0, created INTEGER, updated INTEGER, src TEXT)`,
  `CREATE TABLE IF NOT EXISTS votes(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, kind TEXT NOT NULL, item_id TEXT, payload TEXT, at INTEGER, settled INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS diary(work_id TEXT NOT NULL, day TEXT NOT NULL, text TEXT, PRIMARY KEY(work_id, day))`,
  `CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, title TEXT, msgs TEXT, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, prompt INTEGER DEFAULT 0, cached INTEGER DEFAULT 0, completion INTEGER DEFAULT 0, calls INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS memory_work ON memory(work_id, layer)`,
  `CREATE INDEX IF NOT EXISTS votes_work ON votes(work_id, settled)`,
  `CREATE INDEX IF NOT EXISTS text_work ON chapter_text(work_id)`,
];

async function tauriDb(): Promise<Db> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const db = await Database.load("sqlite:moshu.db");
  const { appConfigDir } = await import("@tauri-apps/api/path");
  return {
    async exec(sql, params = []) {
      await db.execute(sql, params as unknown[]);
    },
    async all(sql, params = []) {
      return (await db.select(sql, params as unknown[])) as any[];
    },
    // tauri-plugin-sql 把数据库放在应用配置目录
    dir: () => appConfigDir(),
  };
}

const IDB_NAME = "moshu";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const d = await idb();
  return new Promise((res, rej) => {
    const q = d.transaction("files").objectStore("files").get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbPut(key: string, v: Uint8Array) {
  const d = await idb();
  await new Promise<void>((res, rej) => {
    const t = d.transaction("files", "readwrite");
    t.objectStore("files").put(v, key);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}

async function browserDb(): Promise<Db> {
  const initSqlJs = (await import("sql.js")).default;
  const wasm = (await import("sql.js/dist/sql-wasm.wasm?url")).default;
  const SQL = await initSqlJs({ locateFile: () => wasm });
  let saved: Uint8Array | undefined;
  try {
    saved = await idbGet("moshu.db");
  } catch {
    saved = undefined;
  }
  const db = new SQL.Database(saved);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idbPut("moshu.db", db.export()).catch(() => {}), 400);
  };
  return {
    async exec(sql, params = []) {
      db.run(sql, params as any[]);
      persist();
    },
    async all(sql, params = []) {
      const st = db.prepare(sql);
      st.bind(params as any[]);
      const out: any[] = [];
      while (st.step()) out.push(st.getAsObject());
      st.free();
      return out;
    },
    dir: async () => null,
  };
}

let ready: Promise<Db> | null = null;
export function getDb(): Promise<Db> {
  if (!ready) {
    ready = (async () => {
      const db = isTauri ? await tauriDb() : await browserDb();
      for (const s of SCHEMA) await db.exec(s);
      return db;
    })();
  }
  return ready;
}
