import { describe, it, expect } from "vitest";
import { parseBook, guessMeta } from "../importTxt";

const titles = (raw: string) => parseBook(raw).vols.map((v) => v.chapters.map((c) => c.title));

describe("紧凑章名补修", () => {
  it("没有任何章节标题时，单独一行的「第三节课」不切章", () => {
    const b = parseBook("他走进教室。\n第三节课\n老师来了。");
    expect(b.vols).toEqual([{ title: "第一卷", chapters: [{ title: "", text: "他走进教室。\n第三节课\n老师来了。" }] }]);
    expect(b.preface).toBe("");
  });
  it("「第一章雾港」下面分「第一节 初到」小节时，章标题仍切开", () => {
    const raw = "第一章雾港\n第一节 初到\nA\n第二节 夜\nB\n第二章夜雨\n第一节 再\nC";
    expect(titles(raw)).toEqual([["雾港", "初到", "夜", "夜雨", "再"]]);
    const b = parseBook(raw);
    expect(b.preface).toBe("");
    expect(b.vols[0].chapters.map((c) => c.text)).toEqual(["", "A", "B", "", "C"]);
  });
  it("全书紧凑写法仍能切开，章末标记和「第三节课」不切", () => {
    expect(titles("第一章雾港\n内容A\n第三节课\n第一章完\n第二章夜雨\n内容B\n第二章完结")).toEqual([["雾港", "夜雨"]]);
    expect(titles("第1章雾港\nA\n第2章夜雨\nB")).toEqual([["雾港", "夜雨"]]);
    expect(titles("第一回雾港\nA\n第二回夜雨\nB")).toEqual([["雾港", "夜雨"]]);
  });
  it("「第一章 雾港」的书里单独一行「第三节课」仍留在正文", () => {
    const b = parseBook("第一章 雾港\n他走进教室。\n第三节课\n老师来了。");
    expect(b.vols[0].chapters.map((c) => c.title)).toEqual(["雾港"]);
    expect(b.vols[0].chapters[0].text).toBe("他走进教室。\n第三节课\n老师来了。");
  });
  it("没有章节标题时书名照常猜", () => {
    const raw = "雾港\n作者：某人\n他走进教室。\n第三节课\n老师来了。";
    expect(guessMeta(raw, parseBook(raw).preface).name).toBe("雾港");
  });
});
