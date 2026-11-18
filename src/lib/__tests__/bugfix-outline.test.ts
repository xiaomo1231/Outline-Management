import { describe, expect, it, vi } from "vitest";

// 回收站的文档存在 Map 里；删章会查 memory 表，这里给一个空实现
const st = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));
vi.mock("../db", () => ({
  isTauri: false,
  getDb: async () => ({ exec: async () => {}, all: async () => [] }),
}));
vi.mock("../repo", () => ({
  loadDoc: async (w: string, k: string, fb: unknown) => st.docs.get(w + k) ?? fb,
  saveDoc: async (w: string, k: string, v: unknown) => void st.docs.set(w + k, v),
  markTextDeleted: async () => {},
}));

import { useStore } from "../store";
import { listTrash, restoreItem, trashChapter, trashScene } from "../trash";
import { buildSync, eventToOutline, moveChapter, moveScene, parseQuickChapters, plants, sceneToEvent, splitChapterOutline, targetChapter, allChapters, chapterToEvent } from "../outline";
import { dropPl, newArc, redistribute, total } from "../plan";
import type { Arc, Chapter, Scene, StoryEvent, Volume } from "../types";

const sc = (id: string, t = id, more: Partial<Scene> = {}): Scene => ({ id, t, goal: "", conf: "", who: [], plant: "", pay: "", ...more });
const ch = (id: string, scenes: Scene[] = [], title = id): Chapter => ({ id, title, status: "大纲", scenes });
const ids = (vols: Volume[]) => vols.map((v) => v.chapters.map((c) => c.id + (c.scenes.length ? ":" + c.scenes.map((s) => s.id).join("") : "")).join(" "));

describe("M12 回收站恢复后场景和事件重新关联", () => {
  it("删场景（保留事件）再恢复，事件的 sc 接回来，同步不再造重复场景", async () => {
    const vols: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1", [sc("A", "A", { day: 2 })])] }];
    const events: StoryEvent[] = [];
    sceneToEvent(vols, events, vols[0].chapters[0].scenes[0], allChapters(vols)[0]);
    useStore.setState({ work: { id: "w" } as any, vols, events, chars: [] });
    await trashScene("w", 0, 0, 0, false);
    expect(useStore.getState().events[0].sc).toBeUndefined();
    const [item] = await listTrash("w");
    await restoreItem("w", item.id);
    const s = useStore.getState();
    expect(s.vols[0].chapters[0].scenes[0].ev).toBe(s.events[0].id);
    expect(s.events[0].sc).toBe("A");
    expect(buildSync({ vols: s.vols, events: s.events, plan: [] }).items.filter((x) => x.sec === "A")).toEqual([]);
  });

  it("删整章再恢复，场景关联和整章事件的章节都接回来", async () => {
    st.docs.clear();
    const vols: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1", [sc("A", "A", { day: 1 })]), ch("c2", [], "乙")] }];
    const events: StoryEvent[] = [];
    sceneToEvent(vols, events, vols[0].chapters[0].scenes[0], allChapters(vols)[0]);
    chapterToEvent(vols, events, allChapters(vols)[1], 2);
    useStore.setState({ work: { id: "w" } as any, vols, events, chars: [] });
    await trashChapter("w", 0, 0, 1);
    await trashChapter("w", 0, 0, 1);
    for (const it of await listTrash("w")) await restoreItem("w", it.id);
    const s = useStore.getState();
    expect(s.vols[0].chapters.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(s.events.find((e) => e.t === "A")).toMatchObject({ sc: "A", ch: "c1" });
    expect(s.events.find((e) => e.t === "乙")!.ch).toBe("c2");
    expect(buildSync({ vols: s.vols, events: s.events, plan: [] }).items.filter((x) => x.sec === "A")).toEqual([]);
  });

  it("事件已被删掉时，恢复的场景清掉 ev", async () => {
    st.docs.clear();
    const vols: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1", [sc("A", "A", { day: 1 })])] }];
    const events: StoryEvent[] = [];
    sceneToEvent(vols, events, vols[0].chapters[0].scenes[0], allChapters(vols)[0]);
    useStore.setState({ work: { id: "w" } as any, vols, events, chars: [] });
    await trashScene("w", 0, 0, 0, true);
    const [item] = await listTrash("w");
    await restoreItem("w", item.id);
    expect(useStore.getState().vols[0].chapters[0].scenes[0].ev).toBeUndefined();
  });
});

describe("M13 / M14 拖动排序", () => {
  const book = (): Volume[] => [
    { id: "v1", title: "一", chapters: [ch("甲", [sc("A"), sc("B"), sc("C")]), ch("乙"), ch("丙")] },
    { id: "v2", title: "二", chapters: [] },
  ];
  it("场景往下拖一格能换位，拖到章标题放到最后", () => {
    let v = book();
    moveScene(v, [], "甲", 0, "甲", 1);
    expect(ids(v)[0]).toBe("甲:BAC 乙 丙");
    v = book();
    moveScene(v, [], "甲", 0, "甲", 2);
    expect(ids(v)[0]).toBe("甲:BCA 乙 丙");
    v = book();
    moveScene(v, [], "甲", 0, "甲", null);
    expect(ids(v)[0]).toBe("甲:BCA 乙 丙");
    v = book();
    moveScene(v, [], "甲", 2, "甲", 0);
    expect(ids(v)[0]).toBe("甲:CAB 乙 丙");
  });
  it("章往下拖一格能换位，往上拖放在目标前面", () => {
    let v = book();
    moveChapter(v, [], "乙", "丙");
    expect(ids(v)[0]).toBe("甲:ABC 丙 乙");
    v = book();
    moveChapter(v, [], "丙", "甲");
    expect(ids(v)[0]).toBe("丙 甲:ABC 乙");
  });
  it("章能拖进空卷，也能放到本卷末尾", () => {
    let v = book();
    expect(moveChapter(v, [], "乙", null, 1)).toBe(true);
    expect(ids(v)).toEqual(["甲:ABC 丙", "乙"]);
    v = book();
    moveChapter(v, [], "甲", null, 0);
    expect(ids(v)[0]).toBe("乙 丙 甲:ABC");
  });
});

describe("M16 已关联事件的场景拖到别的章，事件跟着记到新章", () => {
  it("事件的 ch 改成新章", () => {
    const v: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1", [sc("A", "A", { day: 1 })]), ch("c2", [sc("X")])] }];
    const events: StoryEvent[] = [];
    sceneToEvent(v, events, v[0].chapters[0].scenes[0], allChapters(v)[0]);
    moveScene(v, events, "c1", 0, "c2", 0);
    expect(ids(v)).toEqual(["c1 c2:AX"]);
    expect(events[0].ch).toBe("c2");
  });
});

describe("M17 删除事件段或阶段后，章节的所属阶段跟着调整", () => {
  it("删段：被删段的章清空，后面段的下标前移", () => {
    const v: Volume[] = [{ id: "v", title: "一", chapters: [{ ...ch("c1"), pl: { a: 0, p: 1 } }, { ...ch("c2"), pl: { a: 1, p: 1 } }] }];
    dropPl(v, 0);
    expect(v[0].chapters.map((c) => c.pl)).toEqual([null, { a: 0, p: 1 }]);
  });
  it("删阶段：同段后面的阶段前移，别的段不动", () => {
    const v: Volume[] = [{ id: "v", title: "一", chapters: [{ ...ch("c1"), pl: { a: 0, p: 1 } }, { ...ch("c2"), pl: { a: 0, p: 2 } }, { ...ch("c3"), pl: { a: 1, p: 2 } }, { ...ch("c4"), pl: { a: 0, p: -1 } }] }];
    dropPl(v, 0, 1);
    expect(v[0].chapters.map((c) => c.pl)).toEqual([null, { a: 0, p: 1 }, { a: 1, p: 2 }, { a: 0, p: -1 }]);
  });
});

describe("M19 同步可以重复执行", () => {
  it("第二次同步不会把整章事件又变回场景", () => {
    const d = { vols: [{ id: "v", title: "一", chapters: [ch("c1", [], "甲"), ch("c2", [], "乙")] }] as Volume[], events: [] as StoryEvent[], plan: [] as Arc[] };
    for (const x of buildSync(d).items) if (x.on) x.run(d, []);
    expect(d.events.length).toBe(2);
    expect(buildSync(d).items).toEqual([]);
  });
});

describe("M20 事件导入大纲时人物名优先精确匹配", () => {
  it("「李四」不会被记成「李四娘」，简称仍能认到全名", () => {
    const v: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1")] }];
    const s = eventToOutline(v, { id: "e", day: 1, ch: "c1", t: "x", who: "李四、王", ty: "main" }, ["李四娘", "李四", "王五"]);
    expect(s!.who).toEqual(["李四", "王五"]);
  });
});

describe("L21 没填章节的事件按时间放", () => {
  it("比所有场景都早的事件放到前面的章，而不是最后一章", () => {
    const v: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1"), ch("c2", [sc("a", "a", { day: 3 })]), ch("c3", [sc("b", "b", { day: 5 })])] }];
    expect(targetChapter(v, { id: "e", day: 1, ch: null, t: "开场", who: "", ty: "main" })!.r.ch.id).toBe("c1");
    expect(targetChapter(v, { id: "e", day: 4, ch: null, t: "x", who: "", ty: "main" })!.r.ch.id).toBe("c2");
    expect(targetChapter(v, { id: "e", day: -3, ch: null, t: "前史", who: "", ty: "main" })!.r.ch.id).toBe("c1");
  });
});

describe("L23 篇幅规划总章数取小值", () => {
  it("每个阶段至少 1 章，总数能凑就等于填的数", () => {
    for (const t of ["explore", "fight", "romance", "mystery", "daily"]) {
      for (const T of [3, 4, 5, 7, 20, 31]) {
        const a = newArc("x", t, T, 0);
        expect(a.ph.every((p) => p.c >= 1)).toBe(true);
        expect(total(a)).toBe(Math.max(T, a.ph.length));
      }
    }
  });
  it("重新分配后返回实际总数", () => {
    const a = newArc("x", "explore", 20, 0);
    expect(redistribute(a, 3)).toBe(4);
    expect(total(a)).toBe(4);
    expect(redistribute(a, 5)).toBe(5);
    expect(a.ph.every((p) => p.c >= 1)).toBe(true);
    expect(redistribute(a, 47)).toBe(47);
  });
});

describe("L25 伏笔名带全角括号", () => {
  it("埋和收对得上", () => {
    const v: Volume[] = [{ id: "v", title: "一", chapters: [ch("c1", [sc("a", "a", { plant: "玉佩（母亲遗物）" })]), ch("c2", [sc("b", "b", { pay: "玉佩（母亲遗物）" })])] }];
    expect(plants(v, [])).toEqual([{ name: "玉佩（母亲遗物）", plantNo: 1, payNo: 2 }]);
  });
});

describe("L30 带「零」的中文章号", () => {
  it("一次加多章和多章大纲拆分都认", () => {
    expect(parseQuickChapters("第一百零一章 风起\n第两千章 终")).toEqual([
      { t: "风起", ol: "", hook: "" },
      { t: "终", ol: "", hook: "" },
    ]);
    expect(splitChapterOutline("第零章 序幕：开场\n第一章 风起：出发").map((x) => x.t)).toEqual(["序幕", "风起"]);
  });
});
