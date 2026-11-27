import { describe, expect, it } from "vitest";
import { fromSegs, joinOl, olText, parseOl, toSegs } from "../chapterOutline";

describe("分段章纲", () => {
  it("分段写进去再拆出来不变，空段也保留", () => {
    const segs = [
      { k: "起因", t: "主角夜探档案室" },
      { k: "经过", t: "" },
      { k: "转折", t: "被管理员撞见\n只好撒谎" },
    ];
    expect(parseOl(joinOl(segs))).toEqual(segs);
  });
  it("旧数据（没开分段）原样给 AI，里面的【】不当段名", () => {
    expect(olText({ ol: "【系统】叮！主角获得奖励" })).toBe("【系统】叮！主角获得奖励");
  });
  it("分段的给 AI 时去掉空段、合成一行", () => {
    expect(olText({ ol: "【起因】甲\n【经过】\n【结果】乙\n丙", olSeg: true })).toBe("【起因】甲 【结果】乙 丙");
    expect(olText({ ol: "【起因】\n【经过】", olSeg: true })).toBe("");
  });
  it("AI 改大纲时没带段名，开头的文字算作没名字的一段", () => {
    expect(parseOl("一整段新大纲")).toEqual([{ k: "", t: "一整段新大纲" }]);
    expect(parseOl("前言【起因】甲")).toEqual([{ k: "", t: "前言" }, { k: "起因", t: "甲" }]);
  });
  it("自由文字和分段互相转换", () => {
    expect(toSegs("").map((s) => s.k)).toEqual(["起因", "经过", "转折", "结果"]);
    expect(toSegs("一句话")[0]).toEqual({ k: "起因", t: "一句话" });
    expect(toSegs("甲\n乙\n\n丙").map((s) => s.t)).toEqual(["甲", "乙", "丙"]);
    expect(fromSegs([{ k: "起因", t: "甲" }, { k: "经过", t: "" }, { k: "结果", t: "乙" }])).toBe("甲\n乙");
  });
});
