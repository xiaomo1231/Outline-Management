import { describe, expect, it, vi } from "vitest";

// 用 sql.js 在内存里建一个只有 memory 表的库；回收站等文档存在 Map 里
const st = vi.hoisted(() => ({ docs: new Map<string, unknown>(), db: null as any }));
vi.mock("../db", () => ({
  isTauri: false,
  getDb: async () => {
    if (!st.db) {
      const SQL = await (await import("sql.js")).default();
      const d = new SQL.Database();
      d.run(`CREATE TABLE memory(id TEXT PRIMARY KEY, work_id TEXT NOT NULL, layer INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, short TEXT, ch INTEGER, hits INTEGER DEFAULT 0, last_hit INTEGER DEFAULT 0, score REAL DEFAULT 0, created INTEGER, updated INTEGER, src TEXT)`);
      st.db = {
        exec: async (sql: string, p: unknown[] = []) => void d.run(sql, p as any),
        all: async (sql: string, p: unknown[] = []) => {
          const s = d.prepare(sql);
          s.bind(p as any);
          const out: any[] = [];
          while (s.step()) out.push(s.getAsObject());
          s.free();
          return out;
        },
      };
    }
    return st.db;
  },
}));
vi.mock("../repo", () => ({
  loadDoc: async (w: string, k: string, fb: unknown) => st.docs.get(w + k) ?? fb,
  saveDoc: async (w: string, k: string, v: unknown) => void st.docs.set(w + k, v),
  markTextDeleted: async () => {},
}));

import { useStore } from "../store";
import { restoreItem, trashChapter, listTrash } from "../trash";
import { getDb } from "../db";

describe("M25 删掉已归档的章，这章的人设变化和事实不再影响全书", () => {
  it("删章时收起，恢复时放回", async () => {
    const ch = (id: string) => ({ id, title: id, status: "已写", scenes: [] });
    useStore.setState({
      work: { id: "w" } as any,
      vols: [{ id: "v", title: "一", chapters: [ch("c1"), ch("c2"), ch("c3")] }] as any,
      events: [],
      chars: [
        {
          id: "p1",
          name: "张三",
          role: "",
          f: { id: "农夫" },
          changes: [
            { id: "x3", ch: "c3", field: "id", from: "农夫", to: "已死亡的鬼魂", cause: "", by: "ai", at: 1, status: "applied" },
            { id: "x2", ch: "c2", field: "id", from: "农夫", to: "猎户", cause: "", by: "ai", at: 1, status: "applied" },
          ],
        },
      ] as any,
    });
    const db = await getDb();
    await db.exec(`INSERT INTO memory(id, work_id, layer, kind, text, short, ch, src) VALUES('m1','w',2,'fact','张三在第三章死了','',3,'归档:c3')`);
    await db.exec(`INSERT INTO memory(id, work_id, layer, kind, text, short, ch, src) VALUES('m2','w',1,'fact','别的事实','',2,'归档:c2')`);

    await trashChapter("w", 0, 2, 3);
    let s = useStore.getState();
    expect(s.chars[0].changes!.map((x) => x.id)).toEqual(["x2"]);
    expect((await db.all(`SELECT id FROM memory`)).map((x: any) => x.id)).toEqual(["m2"]);

    const [item] = await listTrash("w");
    await restoreItem("w", item.id);
    s = useStore.getState();
    expect(s.vols[0].chapters.map((x) => x.id)).toEqual(["c1", "c2", "c3"]);
    expect(s.chars[0].changes!.map((x) => x.id).sort()).toEqual(["x2", "x3"]);
    const back = await db.all<any>(`SELECT * FROM memory WHERE id='m1'`);
    expect(back[0]).toMatchObject({ text: "张三在第三章死了", layer: 2, src: "归档:c3" });
  });
});
