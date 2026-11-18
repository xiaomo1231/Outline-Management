import { describe, expect, it } from "vitest";
import { lastDaily, lastDue, owing, shorten, type MemLogEntry } from "../memory";
import { str, toArchive } from "../ai/archive";

const at = (s: string) => new Date(s).getTime();
const entry = (when: string, daily?: string): MemLogEntry => ({ at: at(when), day: when.slice(0, 10), kind: "script", ok: true, lines: [], ...(daily === undefined ? {} : { daily }) });

describe("H5 没有待整理票时也要到点结账", () => {
  it("新书写过字、从没整理过，过了 22:05 就该整理", () => {
    const now = at("2026-11-18T23:30:00");
    const r = owing("22:05", undefined, at("2026-11-18T15:00:00"), 0, now);
    expect(r).toEqual({ overdue: true, owe: "2026-11-18" });
  });
  it("从没整理过时，新书第一天早上不补“昨天”", () => {
    expect(owing("22:05", undefined, at("2026-11-18T08:00:00"), 3, at("2026-11-18T09:00:00")).overdue).toBe(false);
  });
  it("从没整理过、昨天写过却没到点就关了，今天早上补昨天的", () => {
    expect(owing("22:05", undefined, at("2026-11-18T15:00:00"), 0, at("2026-11-19T09:00:00"))).toEqual({ overdue: true, owe: "2026-11-18" });
  });
  it("上次结账后什么都没写、也没票，不跑", () => {
    const last = entry("2026-11-17T22:06:00", "2026-11-17");
    expect(owing("22:05", last, at("2026-11-17T20:00:00"), 0, at("2026-11-18T22:30:00")).overdue).toBe(false);
  });
  it("第二天打开时补跑昨天漏掉的", () => {
    const last = entry("2026-11-16T22:06:00", "2026-11-16");
    expect(owing("22:05", last, at("2026-11-17T20:00:00"), 0, at("2026-11-18T09:00:00"))).toEqual({ overdue: true, owe: "2026-11-17" });
  });
});

describe("M30 关窗、「只跑自动整理」不算结账", () => {
  const log = [entry("2026-11-18T15:00:00", ""), entry("2026-11-17T22:06:00", "2026-11-17")];
  it("顺带跑的自动整理不算今天结过账", () => {
    expect(lastDaily(log)?.daily).toBe("2026-11-17");
    expect(owing("22:05", lastDaily(log), at("2026-11-18T14:00:00"), 0, at("2026-11-18T22:30:00"))).toEqual({ overdue: true, owe: "2026-11-18" });
  });
  it("漏跑后第二天早上补跑，账记到 18 号", () => {
    expect(owing("22:05", lastDaily(log), at("2026-11-18T14:00:00"), 0, at("2026-11-19T09:00:00"))).toEqual({ overdue: true, owe: "2026-11-18" });
  });
  it("老日志没有 daily 字段，按结过账算", () => {
    expect(lastDaily([entry("2026-11-18T22:10:00")])?.at).toBe(at("2026-11-18T22:10:00"));
  });
  it("没欠账时 owe 是今天", () => {
    const last = entry("2026-11-17T22:06:00", "2026-11-17");
    expect(owing("22:05", last, 0, 0, at("2026-11-18T15:00:00"))).toEqual({ overdue: false, owe: "2026-11-18" });
  });
});

describe("M31 整点、0 点的整理时间", () => {
  it("21:00 在 21:02 已经到点", () => {
    expect(lastDue("21:00", at("2026-11-18T21:02:30")).getTime()).toBe(at("2026-11-18T21:00:00"));
    expect(owing("21:00", undefined, 1, 1, at("2026-11-18T21:02:30")).overdue).toBe(true);
  });
  it("00:00 不会变成 22:05", () => {
    expect(lastDue("00:00", at("2026-11-18T21:02:30")).getTime()).toBe(at("2026-11-18T00:00:00"));
    expect(owing("00:00", undefined, 1, 1, at("2026-11-18T21:02:30")).overdue).toBe(true);
    expect(lastDue("00:30", at("2026-11-18T21:02:30")).getTime()).toBe(at("2026-11-18T00:30:00"));
  });
  it("读不出来时按 22:05", () => {
    expect(lastDue("", at("2026-11-18T23:00:00")).getTime()).toBe(at("2026-11-18T22:05:00"));
  });
});

describe("L39 以标点开头的记忆短版本不为空", () => {
  it("跳过开头的空句", () => {
    expect(shorten("！！！开头是感叹号的记忆")).toBe("开头是感叹号的记忆");
    expect(shorten("\n第二行才有字。后面")).toBe("第二行才有字");
    expect(shorten("！！！")).toBe("！！！");
    expect(shorten("普通的一句。第二句")).toBe("普通的一句");
  });
});

describe("M27 归档返回结构不对时当成失败", () => {
  it("缺摘要、数组、null 都报错，不产出空归档", () => {
    expect(() => toArchive({ result: "ok" }, 1)).toThrow(/格式不对/);
    expect(() => toArchive([], 1)).toThrow(/格式不对/);
    expect(() => toArchive(null, 1)).toThrow(/格式不对/);
    expect(() => toArchive({ summary: "  " }, 1)).toThrow(/格式不对/);
  });
  it("facts 里的 null 和对象丢掉", () => {
    expect(toArchive({ summary: "摘要", end: "章末", facts: [null, { a: 1 }, "真事实", " ", 3] }, 2)).toEqual({ summary: "摘要", end: "章末", facts: ["真事实", "3"], done: [], no: 2, v: 2 });
  });
});

describe("M28 人设变化的字段规整成字符串", () => {
  it("对象、数组、数字都变成字", () => {
    expect(str({ 职位: "队长" })).toBe("队长");
    expect(str(["甲", "乙"])).toBe("甲、乙");
    expect(str(18)).toBe("18");
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });
});
