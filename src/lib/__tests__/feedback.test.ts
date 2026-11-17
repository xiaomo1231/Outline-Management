import { describe, expect, it } from "vitest";
import { allChapters, buildSync, dayGuess, firstLine, newChapter, parseQuickChapters, splitChapterOutline } from "../outline";
import type { Volume } from "../types";

describe("按模拟用户反馈的修改", () => {
  it("没填故事时间时按章递增，不全堆在第 1 天", () => {
    const vols: Volume[] = [{ id: "v", title: "一", chapters: [newChapter("a"), newChapter("b"), newChapter("c")] }];
    const rs = allChapters(vols);
    expect(rs.map((r) => dayGuess(vols, r).day)).toEqual([1, 2, 3]);
    rs[0].ch.scenes.push({ id: "s", t: "x", goal: "", conf: "", who: [], plant: "", pay: "", day: 10 });
    expect(dayGuess(vols, rs[2])).toEqual({ day: 12, sure: false });
    expect(dayGuess(vols, rs[0])).toEqual({ day: 10, sure: true });
  });

  it("没有场景的章也能进时间线；推断的天数默认不勾；篇幅规划同步默认不勾", () => {
    const a = { ...newChapter("开篇"), ol: "主角到边城" };
    const b = newChapter("");
    b.scenes.push({ id: "s1", t: "夜巡", goal: "", conf: "", who: [], plant: "", pay: "" });
    const vols: Volume[] = [{ id: "v", title: "一", chapters: [a, b] }];
    const { items } = buildSync({ vols, events: [], plan: [] });
    const ch = items.find((i) => i.key === "BC" + a.id)!;
    expect(ch.on).toBe(true);
    const d = { vols: structuredClone(vols), events: [] as any[], plan: [] };
    ch.run(d, []);
    expect(d.events[0]).toMatchObject({ ch: a.id, t: "开篇", process: "主角到边城", day: 1 });
    expect(items.find((i) => i.key === "Bs1")!.on).toBe(false);
  });

  it("一次加多章：一行一章，｜分开", () => {
    expect(parseQuickChapters("第1章 初到边城｜报到｜挖地道\n\n夜巡 | 撞见走私\n顺藤摸瓜")).toEqual([
      { t: "初到边城", ol: "报到", hook: "挖地道" },
      { t: "夜巡", ol: "撞见走私", hook: "" },
      { t: "顺藤摸瓜", ol: "", hook: "" },
    ]);
  });

  it("助手回答：跳过开场白取标题，多章大纲按章拆开", () => {
    const txt = "好的，一个粗略的5章大纲：\n\n**第1章：初到边城**\n主角报到。\n**第2章：夜巡**\n撞见走私。";
    expect(firstLine(txt)).toBe("第1章：初到边城");
    expect(splitChapterOutline(txt)).toEqual([
      { t: "初到边城", ol: "主角报到。" },
      { t: "夜巡", ol: "撞见走私。" },
    ]);
  });
});

import { cnNum } from "../util";
describe("中文数字卷名", () => {
  it("转换", () => {
    expect([1, 2, 10, 11, 20, 25, 100, 105, 110].map(cnNum)).toEqual(["一", "二", "十", "十一", "二十", "二十五", "一百", "一百零五", "一百一十"]);
  });
});

import { dayLabel } from "../outline";
describe("前史和负数天", () => {
  it("天数写法", () => {
    expect(dayLabel(3)).toBe("第 3 天");
    expect(dayLabel(0)).toContain("开篇前");
    expect(dayLabel(-5)).toBe("开篇前 5 天");
    expect(dayLabel(null)).toBe("时间未定");
  });
  it("前史事件同步时默认不勾，预览天数和执行一致", () => {
    const vols: Volume[] = [{ id: "v", title: "第一卷", chapters: [{ ...newChapter("开局"), scenes: [{ id: "s1", t: "回忆", goal: "", conf: "", who: [], plant: "", pay: "", day: -3 }] }] }];
    const { items } = buildSync({ vols, events: [{ id: "e1", day: -10, ch: null, t: "灭门", who: "", ty: "hidden" }], plan: [] });
    expect(items.find((x) => x.key === "Ae1")?.on).toBe(false);
    const b = items.find((x) => x.key === "Bs1")!;
    expect(b.lab).toContain("开篇前 3 天");
    const d = { vols: structuredClone(vols), events: [] as any[], plan: [] };
    b.run(d, []);
    expect(d.events[0].day).toBe(-3);
  });
});
