import { describe, expect, it } from "vitest";
import { guessMeta, parseBook } from "../importTxt";
import { decode } from "../corpus";
import { buildDocx } from "../docx";
import { isPack } from "../pack";

describe("导入 TXT：引子、卷首语不丢", () => {
  it("「引子」「序」「前言」认成一章", () => {
    const raw = "《雾港》\n作者：某人\n简介：一个故事\n引子\n这是引子，很重要的开篇内容。\n第一卷 风起\n第一章 雾港\n正文一";
    const b = parseBook(raw);
    expect(b.vols.map((v) => v.title)).toEqual(["第一卷 风起"]);
    expect(b.vols[0].chapters.map((c) => c.title)).toEqual(["引子", "雾港"]);
    expect(b.vols[0].chapters[0].text).toBe("这是引子，很重要的开篇内容。");
    expect(guessMeta(raw, b.preface).intro).toBe("一个故事");
    expect(parseBook("序\n序的内容\n第一章 甲\n正文").vols[0].chapters[0]).toEqual({ title: "序", text: "序的内容" });
    expect(parseBook("前言\n前言内容\n第一章 甲\n正文").vols[0].chapters[0].title).toBe("前言");
  });
  it("卷标题前已经有「第X章」时不并卷", () => {
    const b = parseBook("第一章 甲\n正文\n第二卷 云\n第二章 乙\n正文");
    expect(b.vols.map((v) => v.title)).toEqual(["第一卷", "第二卷 云"]);
  });
  it("卷标题和本卷第一章之间的文字并进本卷第一章，不进简介", () => {
    const b = parseBook("书名\n第一卷 风起\n卷首语内容很长\n第一章 甲\n正文甲\n第二卷 云\n第二卷的卷首语\n第二章 乙\n正文乙");
    expect(b.preface).toBe("书名");
    expect(b.vols[0].chapters[0].text).toBe("卷首语内容很长\n正文甲");
    expect(b.vols[1].chapters[0].text).toBe("第二卷的卷首语\n正文乙");
  });
  it("开头没归到章的长文字在 rest 里完整保留", () => {
    const long = "很长的开篇。".repeat(80);
    const raw = `雾港\n${long}\n第一章 甲\n正文`;
    const m = guessMeta(raw, parseBook(raw).preface);
    expect(m.rest).toBe(long);
    expect(m.intro.length).toBe(300);
  });
});

describe("导入 TXT：章号和章名之间没有空格", () => {
  it("「第一章雾港」切成两章", () => {
    const raw = "第一章雾港\n内容A\n第二章夜雨\n内容B";
    const b = parseBook(raw);
    expect(b.vols[0].chapters.map((c) => c.title)).toEqual(["雾港", "夜雨"]);
    expect(guessMeta(raw, b.preface).name).toBe("");
  });
  it("正文里以「第X章」开头的句子不当成标题", () => {
    const b = parseBook("第一章 甲\n第二章写完了，他松了口气。\n正文");
    expect(b.vols[0].chapters.length).toBe(1);
  });
  it("章名超过 60 字也认", () => {
    const t = "长".repeat(70);
    const b = parseBook(`第一章 ${t}\n正文一\n第二章 乙\n正文二`);
    expect(b.vols[0].chapters.map((c) => c.title)).toEqual([t, "乙"]);
  });
});

describe("导入 TXT：猜简介和书名", () => {
  it("提到书名的简介句子要保留", () => {
    const raw = "雾港\n作者：某人\n内容简介：\n这是一个关于雾港的故事，雾港城里住着一个少年。\n他要离开。\n第一章 开始\n正文";
    const m = guessMeta(raw, parseBook(raw).preface);
    expect(m.name).toBe("雾港");
    expect(m.intro).toBe("这是一个关于雾港的故事，雾港城里住着一个少年。\n他要离开。");
  });
  it("正文里的《某书》不当书名", () => {
    const raw = "第一章 开始\n他翻开《三国演义》读了起来";
    expect(guessMeta(raw, parseBook(raw).preface).name).toBe("");
  });
});

describe("识别 txt 编码", () => {
  const text = "第一章 雾港\n他走进了雾里……";
  it("带 BOM 的 UTF-16 LE / BE", () => {
    const le = [0xff, 0xfe];
    const be = [0xfe, 0xff];
    for (const c of text) {
      const n = c.charCodeAt(0);
      le.push(n & 0xff, n >> 8);
      be.push(n >> 8, n & 0xff);
    }
    expect(decode(new Uint8Array(le).buffer)).toBe(text);
    expect(decode(new Uint8Array(be).buffer)).toBe(text);
  });
  it("小 UTF-8 文件末尾截断一个字节仍按 UTF-8 读", () => {
    const s = "第一章 雾港\n" + "他走进了雾里。".repeat(100);
    const b = new TextEncoder().encode(s);
    const out = decode(b.slice(0, b.length - 1).buffer);
    expect(out.startsWith("第一章 雾港")).toBe(true);
  });
  it("GBK 仍按 GB18030 读", () => {
    expect(decode(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]).buffer)).toBe("你好");
  });
});

describe("导出 Word", () => {
  it("去掉 XML 不允许的控制字符", () => {
    const d = buildDocx([{ kind: "p", text: "a\fb\u0001c" }]);
    const s = new TextDecoder().decode(d);
    expect(s).toContain(">abc<");
    const body = s.slice(s.indexOf("<w:body>"), s.indexOf("</w:body>"));
    expect(/[\u0001\u000C]/.test(body)).toBe(false);
  });
});

describe("作品包", () => {
  it("缺字段的作品补上默认值", () => {
    const p: any = { format: "moshu-work", version: 1, exportedAt: 1, work: { id: "wtest1" }, tables: {} };
    expect(isPack(p)).toBe(true);
    expect(p.work.name).toBe("导入的作品");
    expect(p.work.goal).toBe(2000);
    expect(typeof p.work.created).toBe("number");
  });
  it("不是作品包就不认", () => {
    expect(isPack({ format: "moshu-work", work: {}, tables: {} })).toBe(false);
    expect(isPack(null)).toBeFalsy();
  });
});
