import { describe, expect, it, vi } from "vitest";
import { backupsToKeep, isShrink, keepVersions, needSnapshot, SNAP_EVERY } from "../versions";
import { parseBook, plainOf, textToHtml } from "../importTxt";
import { crc32, zip } from "../zip";
import { buildDocx } from "../docx";
import { debounce } from "../util";
import { parseBans, scan } from "../aiscan";
import { publishText } from "../editorText";

const H = 3600_000;
const D = 24 * H;

describe("快照规则", () => {
  const now = 1_800_000_000_000;
  it("第一次有字就留，内容没变不留", () => {
    expect(needSnapshot(null, now, { words: 10, html: "<p>a</p>" })).toBe(true);
    expect(needSnapshot(null, now, { words: 0, html: "" })).toBe(false);
    expect(needSnapshot({ at: now - 2 * SNAP_EVERY, words: 10, html: "<p>a</p>" }, now, { words: 10, html: "<p>a</p>" })).toBe(false);
  });
  it("隔 10 分钟或字数变化 500 才留", () => {
    const last = { at: now - 60_000, words: 1000, html: "x" };
    expect(needSnapshot(last, now, { words: 1100, html: "y" })).toBe(false);
    expect(needSnapshot(last, now, { words: 1500, html: "y" })).toBe(true);
    expect(needSnapshot(last, now, { words: 400, html: "y" })).toBe(true);
    expect(needSnapshot({ ...last, at: now - SNAP_EVERY }, now, { words: 1001, html: "y" })).toBe(true);
  });
  it("字数骤降：原来 500 字以上、少一半以上", () => {
    expect(isShrink(3000, 0)).toBe(true);
    expect(isShrink(3000, 1400)).toBe(true);
    expect(isShrink(3000, 1600)).toBe(false);
    expect(isShrink(400, 0)).toBe(false);
  });
  it("保留规则：一天内全留，一周内每小时一份，一月内每天一份，更早每周一份", () => {
    const now = Date.UTC(2026, 10, 12, 12);
    const list: { id: string; at: number }[] = [];
    // 最近 60 天，每 20 分钟一份
    for (let t = now; t > now - 60 * D; t -= H / 3) list.push({ id: "v" + t, at: t });
    const keep = keepVersions(list, now);
    const inDay = list.filter((v) => now - v.at < D);
    expect(inDay.every((v) => keep.has(v.id))).toBe(true);
    const week = list.filter((v) => now - v.at >= D && now - v.at < 7 * D && keep.has(v.id));
    expect(week.length).toBeGreaterThanOrEqual(6 * 24 - 1);
    expect(week.length).toBeLessThanOrEqual(6 * 24 + 1);
    const month = list.filter((v) => now - v.at >= 7 * D && now - v.at < 30 * D && keep.has(v.id));
    expect(month.length).toBeGreaterThanOrEqual(22);
    expect(month.length).toBeLessThanOrEqual(24);
    const old = list.filter((v) => now - v.at >= 30 * D && keep.has(v.id));
    expect(old.length).toBeLessThanOrEqual(6);
    expect(keep.size).toBeLessThan(list.length / 5);
  });
  it("数据库备份：最近 24 份全留，另外 14 天每天一份", () => {
    const names: string[] = [];
    const t0 = Date.UTC(2026, 10, 12, 20);
    for (let i = 0; i < 30 * 12; i++) {
      const t = t0 - i * 2 * H;
      names.push(`moshu-${new Date(t).toISOString().slice(0, 10)}-${t}.db`);
    }
    names.push("别的文件.txt");
    const keep = backupsToKeep(names);
    expect(keep.has(names[0])).toBe(true);
    expect(keep.has(names[23])).toBe(true);
    expect(keep.has("别的文件.txt")).toBe(false);
    const days = new Set([...keep].map((n) => n.slice(6, 16)));
    expect(days.size).toBe(14);
    expect(keep.size).toBeLessThanOrEqual(24 + 14);
  });
});

describe("导入 txt", () => {
  const raw = "书名简介一行\r\n\r\n第一卷 风起\n第一章 雾港\n　　第一段。\n\n第二段。\n第2章\n内容二\n第二卷\n楔子\n开头\n第三章：收网\n内容三\n";
  it("按卷和章切开，章名去掉章号", () => {
    const b = parseBook(raw);
    expect(b.preface).toBe("书名简介一行");
    expect(b.vols.map((v) => v.title)).toEqual(["第一卷 风起", "第二卷"]);
    expect(b.vols[0].chapters.map((c) => c.title)).toEqual(["雾港", ""]);
    expect(b.vols[1].chapters.map((c) => c.title)).toEqual(["楔子", "收网"]);
    expect(b.vols[0].chapters[0].text).toContain("第二段。");
  });
  it("没有章节标题时整本当一章", () => {
    const b = parseBook("只有一段文字\n第二行");
    expect(b.vols.length).toBe(1);
    expect(b.vols[0].chapters.length).toBe(1);
  });
  it("转成编辑器 HTML 时去掉缩进、转义尖括号", () => {
    expect(textToHtml("　　他说<你好>\n\n  第二段")).toBe("<p>他说&lt;你好&gt;</p><p>第二段</p>");
    expect(plainOf("　　甲\n\n乙")).toBe("甲\n乙");
  });
});

describe("导出", () => {
  it("crc32 正确", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("zip 结构完整：本地头、中央目录、结尾记录", () => {
    const z = zip([{ name: "a.txt", data: "你好" }, { name: "b/c.xml", data: "<x/>" }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    const cenOff = dv.getUint32(end + 16, true);
    expect(dv.getUint32(cenOff, true)).toBe(0x02014b50);
  });
  it("docx 里有正文段落", () => {
    const d = buildDocx([{ kind: "h2", text: "第1章 雾港" }, { kind: "p", text: "A&B" }]);
    const s = new TextDecoder().decode(d);
    expect(s).toContain("word/document.xml");
    expect(s).toContain("A&amp;B");
  });
  it("发文格式：首行两个全角空格，段间空行", () => {
    expect(publishText("甲\n\n 乙 ")).toBe("　　甲\n\n　　乙");
  });
});

describe("防抖保存", () => {
  it("pending 和 flush", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async (x: number) => x * 2);
    const d = debounce(fn, 700);
    expect(d.pending()).toBe(false);
    d(1);
    expect(d.pending()).toBe(true);
    expect(await d.flush(2)).toBe(4);
    expect(d.pending()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("禁用清单", () => {
  it("短的当词扫描，长的只进提示词", () => {
    const b = parseBans("嘴角勾起\n\n主角心软放过反派然后被反杀\n 一抹 ");
    expect(b.all.length).toBe(3);
    expect(b.words).toEqual(["嘴角勾起", "一抹"]);
    expect(scan("他嘴角勾起，嘴角勾起。", ["嘴角勾起"]).find((r) => r.label === "禁用：嘴角勾起")?.n).toBe(2);
  });
});
