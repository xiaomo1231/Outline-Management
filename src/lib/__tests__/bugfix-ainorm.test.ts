// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { names, num, str, tidyEvents, tidyVols } from "../ai/norm";
import { normAlign, normCont, normEvents, normOoc, normScan, normSplit, normTidy } from "../ai/tasks";
import { whoList } from "../../pages/outline/Events";
import { aiCharsInHtml, replaceInHtml } from "../findReplace";

describe("AI 返回格式不对时不白屏、不存坏数据", () => {
  it("基础规整：文字、人名、数字", () => {
    expect(str({ 目标: "找到船票" })).toBe("找到船票");
    expect(names("林舟、苏晚")).toEqual(["林舟", "苏晚"]);
    expect(names(["林舟", "", "苏晚", "林舟"])).toEqual(["林舟", "苏晚"]);
    expect(num("第3天")).toBe(3);
    expect(num({})).toBeNull();
  });

  it("高-2 提取事件：人物是数组、天数是文字", () => {
    const evs = normEvents({ events: [{ day: "第3天", t: "到码头", who: ["林舟", "苏晚"], ty: "怪类型" }, { t: { a: "x" }, who: null }, "坏"] }, "c1");
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ day: 3, who: "林舟、苏晚", ty: "main", ch: "c1" });
    expect(typeof evs[1].t).toBe("string");
    expect(normEvents({ events: { a: 1 } }, "c1")).toEqual([]);
  });

  it("中-1 检查大纲：问题是对象、列表不是数组", () => {
    expect(normTidy({ issues: { a: "断线" } })).toEqual([]);
    const r = normTidy({ issues: [{ lv: "r", text: { 问题: "断线", 理由: "x" }, goto: "3" }] });
    expect(r[0].text).toBe("断线，x");
    expect(r[0].goto).toBe(3);
  });

  it("中-2 加场景：人物是字符串时按顿号拆，不拆成单字", () => {
    const r = normTidy({ issues: [{ text: "缺", add: { chapter: 3, scene: { t: "补", goal: { a: "g" }, who: "林舟、苏晚" } } }] });
    expect(r[0].add!.scene.who).toEqual(["林舟", "苏晚"]);
    expect(r[0].add!.scene.goal).toBe("g");
  });

  it("高-1 拆卷、对齐：目标和冲突一律成文字，人物字符串不丢", () => {
    const s = normSplit({ chapters: [{ t: "一", ol: { x: "大纲" }, scenes: [{ t: "场", goal: { 目标: "船票" }, conf: 1, who: "林舟、苏晚", day: "2" }] }] }, 3);
    expect(s[0].ol).toBe("大纲");
    expect(s[0].scenes[0]).toMatchObject({ goal: "船票", conf: "1", who: ["林舟", "苏晚"], day: 2 });
    expect(normSplit({ chapters: "坏" }, 3)).toEqual([]);
    const a = normAlign({ chapters: [{ no: "5", ol: { a: "新" }, scenes: [{ i: "0", goal: { b: "g" } }, { goal: "没有序号" }] }, { no: 99 }] }, new Set([5]));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ no: 5, ol: "新" });
    expect(a[0].scenes).toEqual([{ i: 0, goal: "g", conf: "", who: undefined }]);
  });

  it("中-4 一致性检查：change 的新值是对象时转成文字", () => {
    const r = normOoc({ issues: [{ who: "林舟", suggestion: { a: "改" }, change: { field: "look", to: { 外貌: "有疤" } } }] });
    expect(r[0].suggestion).toBe("改");
    expect(r[0].change).toEqual({ field: "look", to: "有疤", cause: "" });
    expect(normOoc({ issues: "坏" })).toEqual([]);
    expect(normCont({ issues: [{ quote: ["a", "b"], suggestion: "s" }] })[0].quote).toBe("a、b");
  });

  it("从正文整理人物：字段内容是对象时转成文字", () => {
    const r = normScan({ updates: [{ name: "林舟", field: "look", value: { a: "高" }, ch: "2" }], added: [{ name: "苏晚", fields: { tag: ["温柔"] } }] });
    expect(r.updates[0]).toEqual({ name: "林舟", field: "look", value: "高", ch: 2 });
    expect(r.added[0].fields).toEqual({ tag: "温柔" });
  });

  it("已经存进去的坏数据，打开书时规整", () => {
    const vols: any = [{ id: "v", title: "一", chapters: [{ id: "c", title: "章", status: "大纲", scenes: [{ id: "s", t: "场", goal: { 目标: "船票" }, conf: "", who: "林舟、苏晚", plant: "", pay: "" }] }] }];
    const v = tidyVols(vols);
    expect(v[0].chapters[0].scenes[0].goal).toBe("船票");
    expect(v[0].chapters[0].scenes[0].who).toEqual(["林舟", "苏晚"]);
    const ok: any = [{ id: "v", title: "一", chapters: [{ id: "c", title: "章", status: "大纲", scenes: [{ id: "s", t: "场", goal: "", conf: "", who: [], plant: "", pay: "" }] }] }];
    expect(tidyVols(ok)[0]).toBe(ok[0]);
    const e = tidyEvents([{ id: "e", day: "3" as any, ch: null, t: "x", who: ["林舟"] as any, ty: "main" }]);
    expect(e[0]).toMatchObject({ day: 3, who: "林舟" });
    expect(whoList(["林舟", "苏晚"])).toEqual(["林舟", "苏晚"]);
  });
});

describe("低-3 全书替换：其他章的 AI 字和本章同一口径", () => {
  it("被替换的段落里 AI 原样变成你改过，AI 字数按新正文算", () => {
    const html = '<p><span class="ai">雨停了，风也停了</span></p><p><span class="ai">天亮了</span></p>';
    const r = replaceInHtml(html, "雨", "雪");
    expect(r.html).toContain('<span class="aied">雪停了');
    expect(r.html).toContain('<span class="ai">天亮了');
    expect(aiCharsInHtml(r.html)).toBe(aiCharsInHtml(html));
  });
});
