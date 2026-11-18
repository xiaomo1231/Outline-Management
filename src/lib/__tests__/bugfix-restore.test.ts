import { describe, expect, it, vi } from "vitest";

// M40 复测：整库恢复要在一个真事务里做。用 sql.js 当「现在的库」和「备份」，SQL/文件/路径插件都换成假的
const st = vi.hoisted(() => ({ db: null as any, bak: null as any, files: [] as string[] }));
vi.mock("../db", () => ({ isTauri: true, getDb: async () => st.db }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...p: string[]) => p.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => true,
  mkdir: async () => {},
  remove: async () => {},
  copyFile: async () => {},
  stat: async () => ({ size: 1 }),
  readDir: async () => st.files.map((name) => ({ name })),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: async () => ({ select: (sql: string, p?: unknown[]) => st.bak.all(sql, p), close: async () => {} }) },
}));

import { replaceTables, readTables, restoreAll, restoreSql, restoring, RestoreError } from "../backup";

const BAK = "moshu-2026-11-18-1000.db";
const PRE = "moshu-2026-11-18-2000.db";

async function mkDb(bytes?: Uint8Array) {
  const SQL = await (await import("sql.js")).default();
  const d = new SQL.Database(bytes);
  return {
    raw: d,
    // 没有参数的整段 SQL 和桌面版插件一样逐条执行；备份路径换成 sql.js 内存文件系统里备份库的文件名
    exec: async (sql: string, p: unknown[] = []) => {
      if (sql.startsWith("VACUUM")) return;
      if (!p.length) d.exec(sql.replace(`/data/backups/${BAK}`, "/" + st.bak?.raw.filename));
      else d.run(sql, p as any);
    },
    all: async (sql: string, p: unknown[] = []) => {
      const s = d.prepare(sql);
      s.bind(p as any);
      const out: any[] = [];
      while (s.step()) out.push(s.getAsObject());
      s.free();
      return out;
    },
    dir: async () => "/data",
  };
}

const SCHEMA = [
  `CREATE TABLE works(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER)`,
  `CREATE TABLE chapter_text(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, html TEXT, plain TEXT, words INTEGER DEFAULT 0)`,
  `CREATE TABLE chapter_versions(id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, work_id TEXT NOT NULL, html TEXT, plain TEXT, words INTEGER DEFAULT 0, at INTEGER, reason TEXT)`,
  `CREATE TABLE memory(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, text TEXT NOT NULL)`,
  `CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)`,
];

async function setup(badVersion = false) {
  const cur = await mkDb();
  for (const s of SCHEMA) await cur.exec(s.replace("at INTEGER", "at INTEGER NOT NULL"));
  await cur.exec(`INSERT INTO works VALUES('w1','现在',1)`);
  await cur.exec(`INSERT INTO chapter_text VALUES('c1','w1','<p>现在</p>','现在',2)`);
  await cur.exec(`INSERT INTO memory VALUES('m1','w1','现在的记忆')`);
  const b = await mkDb();
  for (const s of SCHEMA) await b.exec(s);
  await b.exec(`INSERT INTO works VALUES('w1','备份',0)`);
  await b.exec(`INSERT INTO chapter_text VALUES('c1','w1','<p>备份</p>','备份',2)`);
  await b.exec(`INSERT INTO chapter_versions VALUES('v1','c1','w1','','',0,${badVersion ? "NULL" : 5},'')`);
  await b.exec(`INSERT INTO memory VALUES('m1','w1','备份的记忆')`);
  // sql.js 的库要导出再载入一次，才会落到它的内存文件系统里，ATTACH 才找得到
  st.bak = await mkDb(b.raw.export());
  st.db = cur;
  st.files = [BAK, PRE];
  return cur;
}

const state = async (db: any) => ({
  works: await db.all(`SELECT * FROM works`),
  text: await db.all(`SELECT * FROM chapter_text`),
  ver: await db.all(`SELECT * FROM chapter_versions`),
  mem: await db.all(`SELECT * FROM memory`),
});

describe("M40 整库恢复在一个事务里做", () => {
  it("正常恢复：整库换成备份；恢复完到重新加载前一直算「正在恢复」，关窗不再写库", async () => {
    const cur = await setup();
    await restoreAll(BAK);
    const s = await state(cur);
    expect(s.works).toEqual([{ id: "w1", data: "备份", updated: 0 }]);
    expect(s.text.map((x: any) => x.plain)).toEqual(["备份"]);
    expect(s.ver.map((x: any) => x.id)).toEqual(["v1"]);
    expect(s.mem.map((x: any) => x.text)).toEqual(["备份的记忆"]);
    expect(restoring()).not.toBeNull();
    // 备份没有挂在连接上，也没有留下事务
    expect(await cur.all(`PRAGMA database_list`)).toHaveLength(1);
    expect(() => cur.raw.exec("BEGIN; ROLLBACK")).not.toThrow();
  });

  it("备份里有坏行（写到一半出错）：事务整个退回，库和恢复前完全一样，也没留下没结束的事务", async () => {
    const cur = await setup(true);
    const before = await state(cur);
    let err: any;
    try {
      await restoreAll(BAK);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RestoreError);
    expect(err.dirty).toBe(false);
    expect(err.message).toMatch(/NOT NULL.*什么都没改/);
    expect(await state(cur)).toEqual(before);
    expect(() => cur.raw.exec("BEGIN; ROLLBACK")).not.toThrow();
    expect(await cur.all(`PRAGMA database_list`)).toHaveLength(1);
    // 库没动，界面的数据还能接着用
    await Promise.resolve();
    expect(restoring()).toBeNull();
  });

  it("恢复到一半进程退出（事务没提交）：重新打开的库还是恢复前的样子", async () => {
    const cur = await setup();
    const before = await state(cur);
    const data = await readTables(st.bak, cur as any);
    const sql = restoreSql("/" + st.bak.raw.filename, "bkx", data).split(";\n");
    // 执行到 COMMIT 之前就「断电」
    cur.raw.exec(sql.slice(0, sql.indexOf("COMMIT")).join(";\n"));
    expect((await cur.all(`SELECT data FROM works`))[0].data).toBe("备份");
    const reopened = await mkDb(cur.raw.export());
    expect(await state(reopened)).toEqual(before);
  });

  it("没给备份文件路径时仍走逐表写入的老路，结果一样", async () => {
    const cur = await setup();
    await replaceTables(cur as any, await readTables(st.bak, cur as any));
    expect((await state(cur)).mem.map((x: any) => x.text)).toEqual(["备份的记忆"]);
  });
});
