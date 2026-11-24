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
import { listTrash, restoreItem, trashChapters } from "../trash";
import { chapterRanges, pickChapters } from "../outline";

const O = ["a", "b", "c", "d", "e"];

describe("大纲页多选章节", () => {
  it("ctrl 点第二章时带上原来选中的那章，再点一次取消", () => {
    expect(pickChapters(O, [], "c", "toggle", null, "a")).toEqual(["a", "c"]);
    expect(pickChapters(O, ["a", "c"], "a", "toggle", "c", "a")).toEqual(["c"]);
    expect(pickChapters(O, [], "c", "toggle", null, null)).toEqual(["c"]);
  });
  it("shift 点从锚点连选一段，往前往后都行", () => {
    expect(pickChapters(O, [], "d", "range", null, "b")).toEqual(["b", "c", "d"]);
    expect(pickChapters(O, ["b", "c", "d"], "a", "range", "c", "b")).toEqual(["a", "b", "c"]);
  });
  it("章号列成区间", () => {
    expect(chapterRanges([5, 1, 2, 3, 8, 9])).toBe("第1–3、5、8–9章");
    expect(chapterRanges([])).toBe("");
  });
  it("批量删章跨卷，回收站标签用删之前的章号，恢复回原位", async () => {
    const ch = (id: string) => ({ id, title: id, status: "大纲", scenes: [] });
    useStore.setState({
      work: { id: "w2" } as any,
      vols: [
        { id: "v1", title: "一", chapters: [ch("c1"), ch("c2"), ch("c3")] },
        { id: "v2", title: "二", chapters: [ch("c4"), ch("c5")] },
      ] as any,
      events: [],
      chars: [],
    });
    expect(await trashChapters("w2", ["c2", "c4", "c5"])).toBe(3);
    const s = useStore.getState();
    expect(s.vols.map((v) => v.chapters.map((c) => c.id))).toEqual([["c1", "c3"], []]);
    const list = await listTrash("w2");
    expect(list.map((x) => x.label).sort()).toEqual(["第2章 c2", "第4章 c4", "第5章 c5"]);
    for (const x of [...list].reverse()) await restoreItem("w2", x.id);
    expect(useStore.getState().vols.map((v) => v.chapters.map((c) => c.id))).toEqual([["c1", "c2", "c3"], ["c4", "c5"]]);
  });
});
