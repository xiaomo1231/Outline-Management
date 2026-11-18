import { describe, expect, it, vi } from "vitest";

// 用 sql.js 在内存里建「现在的库」和「备份」两个库
const st = vi.hoisted(() => ({ db: null as any }));
async function mkDb() {
  const SQL = await (await import("sql.js")).default();
  const d = new SQL.Database();
  return {
    raw: d,
    exec: async (sql: string, p: unknown[] = []) => void d.run(sql, p as any),
    all: async (sql: string, p: unknown[] = []) => {
      const s = d.prepare(sql);
      s.bind(p as any);
      const out: any[] = [];
      while (s.step()) out.push(s.getAsObject());
      s.free();
      return out;
    },
    dir: async () => null,
  };
}
vi.mock("../db", () => ({ isTauri: false, getDb: async () => st.db }));

import { readTables, replaceTables, RestoreError } from "../backup";
import { keepVersions, PULLED_REASON } from "../versions";

const SCHEMA = [
  `CREATE TABLE works(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER)`,
  `CREATE TABLE docs(work_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER, PRIMARY KEY(work_id, kind))`,
  `CREATE TABLE chapter_text(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, html TEXT, plain TEXT, words INTEGER DEFAULT 0)`,
  `CREATE TABLE memory(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, text TEXT NOT NULL)`,
];

describe("M40 整库恢复中途出错时退回原样", () => {
  it("备份里后面的表缺必填列，写到一半出错：前面已经换掉的表也退回恢复前", async () => {
    const cur = await mkDb();
    for (const s of SCHEMA) await cur.exec(s);
    await cur.exec(`INSERT INTO works VALUES('w1','{"name":"现在"}',1)`);
    await cur.exec(`INSERT INTO chapter_text VALUES('c1','w1','<p>现在</p>','现在',2)`);
    await cur.exec(`INSERT INTO memory VALUES('m1','w1','现在的记忆')`);
    st.db = cur;

    const bak = await mkDb();
    await bak.exec(SCHEMA[0]);
    await bak.exec(SCHEMA[2]);
    await bak.exec(`CREATE TABLE memory(id TEXT PRIMARY KEY, work_id TEXT NOT NULL)`); // 缺 text 列
    await bak.exec(`INSERT INTO works VALUES('w1','{"name":"备份"}',0)`);
    await bak.exec(`INSERT INTO chapter_text VALUES('c1','w1','<p>备份</p>','备份',2)`);
    await bak.exec(`INSERT INTO memory VALUES('m1','w1')`);

    const data = await readTables(bak, cur as any);
    let err: any;
    try {
      await replaceTables(cur as any, data);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RestoreError);
    expect(err.dirty).toBe(false);
    expect(await cur.all(`SELECT data FROM works`)).toEqual([{ data: '{"name":"现在"}' }]);
    expect(await cur.all(`SELECT plain FROM chapter_text`)).toEqual([{ plain: "现在" }]);
    expect(await cur.all(`SELECT text FROM memory`)).toEqual([{ text: "现在的记忆" }]);
  });

  it("备份正常时整库换成备份的内容", async () => {
    const cur = await mkDb();
    for (const s of SCHEMA) await cur.exec(s);
    await cur.exec(`INSERT INTO works VALUES('w2','{}',1)`);
    const bak = await mkDb();
    for (const s of SCHEMA) await bak.exec(s);
    await bak.exec(`INSERT INTO works VALUES('w1','{"name":"备份"}',0)`);
    await bak.exec(`INSERT INTO memory VALUES('m1','w1','备份的记忆')`);
    await replaceTables(cur as any, await readTables(bak, cur as any));
    expect(await cur.all(`SELECT id FROM works`)).toEqual([{ id: "w1" }]);
    expect(await cur.all(`SELECT text FROM memory`)).toEqual([{ text: "备份的记忆" }]);
  });
});

describe("L49 从备份取回的版本不会被每日整理清掉", () => {
  const H = 3600_000;
  const now = Date.UTC(2026, 10, 18, 20);
  it("3 天前的备份取回后，同一小时里更晚的快照也不会把它挤掉", () => {
    const at = now - 3 * 24 * H;
    const keep = keepVersions([{ id: "pulled", at, reason: PULLED_REASON }, { id: "snap", at: at + 20 * 60_000, reason: "自动快照" }], now);
    expect([...keep].sort()).toEqual(["pulled", "snap"]);
  });
  it("10 天前同一天的也一样；普通快照仍按天只留一份", () => {
    const at = now - 10 * 24 * H;
    const keep = keepVersions(
      [
        { id: "pulled", at, reason: PULLED_REASON },
        { id: "a", at: at + H },
        { id: "b", at: at + 2 * H },
      ],
      now,
    );
    expect([...keep].sort()).toEqual(["b", "pulled"]);
  });
});
