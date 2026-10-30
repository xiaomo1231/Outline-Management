import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { countWords, chapterNo } from "../util";
import { bookLen, newArc, ranges, redistribute, total, where } from "../plan";
import { allChapters, buildSync, newChapter, newScene, RUN_ORDER, type SyncData } from "../outline";
import { layerFor, score, shorten } from "../memory";
import type { MemItem, Volume } from "../types";

describe("字数", () => {
  it("汉字和全角标点各算 1，英文单词和数字串各算 1", () => {
    expect(countWords("雾从海上压过来。")).toBe(8);
    expect(countWords("他看了 iPhone 15 一眼")).toBe(7);
    expect(countWords("  \n ")).toBe(0);
  });
  it("从章名取章号", () => {
    expect(chapterNo("第12章 雾港")).toBe(12);
    expect(chapterNo("楔子")).toBe(0);
  });
});

describe("篇幅规划", () => {
  it("按类型分配后总数不变", () => {
    for (const t of ["explore", "fight", "romance", "mystery", "daily"]) {
      const a = newArc("测试", t, 30, 2);
      expect(total(a)).toBe(30);
      expect(a.ph.every((p) => p.c >= 1)).toBe(true);
    }
  });
  it("重新分配保持总数", () => {
    const a = newArc("测试", "explore", 20, 0);
    redistribute(a, 47);
    expect(total(a)).toBe(47);
  });
  it("章号定位到事件段和阶段，过渡章是 -1", () => {
    const plan = [newArc("一", "explore", 10, 2), newArc("二", "fight", 10, 3)];
    expect(bookLen(plan)).toBe(25);
    const R = ranges(plan);
    expect(R[0].s).toBe(3);
    expect(where(plan, 1)).toEqual({ a: 0, p: -1 });
    expect(where(plan, 3)?.a).toBe(0);
    expect(where(plan, 13)).toEqual({ a: 1, p: -1 });
    expect(where(plan, 26)).toBeNull();
  });
});

function run(d: SyncData, keys: (k: string) => boolean): SyncData {
  const { items } = buildSync(d);
  return produce(d, (x) => {
    for (const s of RUN_ORDER) for (const it of items) if (it.sec === s && keys(it.key)) it.run(x as SyncData, ["陈渡"]);
  });
}

describe("大纲、时间线、篇幅规划同步", () => {
  const vols = (): Volume[] => {
    const c1 = newChapter("雾起");
    c1.scenes.push({ ...newScene("拆怀表"), day: 1, place: "钟表铺" });
    return [{ id: "v1", title: "第一卷", chapters: [c1, newChapter("旧照片")] }];
  };

  it("大纲 → 时间线：没关联的场景变成事件，并互相关联", () => {
    const d = run({ vols: vols(), events: [], plan: [] }, (k) => k.startsWith("B"));
    expect(d.events).toHaveLength(1);
    const sc = d.vols[0].chapters[0].scenes[0];
    expect(d.events[0].sc).toBe(sc.id);
    expect(sc.ev).toBe(d.events[0].id);
    expect(d.events[0].place).toBe("钟表铺");
    // 再同步一次不会重复
    expect(buildSync(d).items.filter((i) => i.sec === "B")).toHaveLength(0);
  });

  it("篇幅规划 → 大纲：给章标阶段，补建空章是可选项", () => {
    const plan = [newArc("雾港失踪案", "mystery", 6, 1)];
    const items = buildSync({ vols: vols(), events: [], plan }).items;
    expect(items.find((i) => i.key === "C1")?.on).toBe(true);
    expect(items.find((i) => i.key === "C3")?.on).toBe(false);
    const d = run({ vols: vols(), events: [], plan }, (k) => k === "C1" || k === "C3");
    const chs = allChapters(d.vols);
    expect(chs).toHaveLength(7);
    expect(chs[0].ch.pl).toEqual({ a: 0, p: -1 });
    expect(chs.every((r) => r.ch.pl)).toBe(true);
  });

  it("大纲 → 篇幅规划：只改已经写过去的阶段", () => {
    const plan = [newArc("一", "explore", 6, 0)];
    const v = vols();
    // 第一阶段规划的章数和大纲不一致；大纲写到第二阶段
    v[0].chapters[0].pl = { a: 0, p: 0 };
    v[0].chapters[1].pl = { a: 0, p: 1 };
    const before = plan[0].ph[0].c;
    const { items, notes } = buildSync({ vols: v, events: [], plan });
    const d0 = items.find((i) => i.key === "D0:0");
    if (before !== 1) expect(d0?.lab).toContain(`${before} 章 → 1 章`);
    expect(items.some((i) => i.key === "D0:1")).toBe(false);
    expect(notes.some((n) => n.sec === "D")).toBe(true);
  });
});

describe("记忆分数", () => {
  const item = (p: Partial<MemItem>): MemItem => ({ id: "m", work_id: "w", layer: 1, kind: "fact", text: "老人的伞从不打开", short: "", src: "", ch: 1, hits: 0, last_hit: 0, score: 0, created: 0, updated: 0, ...p });
  it("同样输入分数一致", () => {
    const it = item({ hits: 2, last_hit: 1000 });
    expect(score(it, 10, [], 5000)).toBe(score(it, 10, [], 5000));
  });
  it("后面大纲还会用到的条目分数更高", () => {
    expect(score(item({}), 40, ["老人"])).toBeGreaterThan(score(item({}), 40, []));
  });
  it("离当前章越远越低，决定最多掉到中期层", () => {
    expect(score(item({ ch: 1 }), 100, [])).toBeLessThan(score(item({ ch: 95 }), 100, []));
    expect(layerFor(-50, "decision")).toBe(2);
    expect(layerFor(-50, "fact")).toBe(4);
    expect(layerFor(10, "fact")).toBe(1);
  });
  it("短版本取第一句", () => {
    expect(shorten("第一句。第二句。")).toBe("第一句");
  });
});
