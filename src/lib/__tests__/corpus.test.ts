import { describe, expect, it } from "vitest";
import { analyzeBook, decode, dimsFromMetrics, measure, metricsText, nearest, splitChapters } from "../corpus";
import { BUILTIN, compileStyle, emptySetup, leak } from "../style";

const chapter = (i: number) =>
  `第${i}章 风起\n　　雾从海上压过来。他抬头看了一眼。\n　　“走吗？”她问。\n　　“再等等。”\n　　钟楼的影子一点点短下去，街上没有人，只有风把纸屑卷到墙角，又卷回来，像是有人在反复翻同一页书。\n`.repeat(1) +
  "　　他没有回答。\n".repeat(40);

const book = Array.from({ length: 40 }, (_, i) => chapter(i + 1)).join("");

describe("拆书统计", () => {
  it("按章节标题切章", () => {
    const { chs, pseudo } = splitChapters(book);
    expect(pseudo).toBe(false);
    expect(chs).toHaveLength(40);
  });
  it("没有章节标题时按段切，并标记", () => {
    const { pseudo, chs } = splitChapters(book.replace(/第\d+章 风起\n/g, ""));
    expect(pseudo).toBe(true);
    expect(chs.length).toBeGreaterThan(1);
  });
  it("对白、单句成段、问句", () => {
    const m = measure(splitChapters(book).chs);
    expect(m.dialog).toBeGreaterThan(0.03);
    expect(m.dialog).toBeLessThan(0.2);
    expect(m.paraOne).toBeGreaterThan(0.8);
    expect(m.ques).toBeGreaterThan(0);
    expect(m.endShort).toBe(1);
    expect(m.chapLen).toBeGreaterThan(300);
  });
  it("整本分析给出开篇和正文两组数字，样本不超过三段", () => {
    const a = analyzeBook(book);
    expect(a.chapters).toBe(40);
    expect(a.samples.length).toBeLessThanOrEqual(3);
    expect(a.samples.every((x) => x.length <= 1500)).toBe(true);
    expect(dimsFromMetrics(a.body).pov).toContain("第三人称");
    expect(metricsText(a.body, "测试")).toContain("对白约占");
    expect(nearest(a.body, BUILTIN)).toBeTruthy();
  });
  it("GBK 文件能读", () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // “你好”
    expect(decode(gbk.buffer)).toBe("你好");
  });
});

describe("风格库", () => {
  it("内置风格块不含情节和套路词", () => {
    for (const b of BUILTIN) expect(leak(b), b.name).toEqual([]);
  });
  it("核心风格有统计数字时，提示词里带量化参考", () => {
    const s = { ...emptySetup(), core: "guyan" };
    expect(compileStyle(s)).toContain("量化参考");
    expect(compileStyle({ ...emptySetup(), core: "kuai" })).not.toContain("量化参考");
  });
});
