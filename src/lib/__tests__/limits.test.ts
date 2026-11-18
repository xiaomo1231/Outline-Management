import { describe, expect, it } from "vitest";
import {
  activeLimits,
  applySentenceFixes,
  badSentences,
  coreOf,
  ensureLimits,
  findQuotes,
  fromPreset,
  guessType,
  limitsBlock,
  limitsTail,
  migrateBans,
  noteConflicts,
  parseWords,
  scanLimits,
  splitLimitNote,
} from "../limits";
import type { WriteLimit } from "../types";

const L = (p: Partial<WriteLimit>): WriteLimit => ({ id: p.id ?? "l" + Math.random(), text: "x", type: "用词语感", level: "never", words: [], except: [], ...p });

describe("旧禁用清单迁移", () => {
  it("短词进词表，长句当情节走向", () => {
    const ls = migrateBans("嘴角勾起\n\n主角心软放过反派然后被反杀\n 一抹 ");
    expect(ls.map((l) => [l.text, l.type, l.level, l.words])).toEqual([
      ["嘴角勾起", "用词语感", "never", ["嘴角勾起"]],
      ["主角心软放过反派然后被反杀", "情节走向", "never", []],
      ["一抹", "用词语感", "never", ["一抹"]],
    ]);
    expect(ls.every((l) => l.fromOld)).toBe(true);
  });
  it("已经有 limits 的不再迁移，空数组也算迁移过", () => {
    expect(ensureLimits([], "嘴角勾起")).toEqual([]);
    expect(ensureLimits(undefined, "嘴角勾起")).toHaveLength(1);
    expect(ensureLimits(undefined, undefined)).toEqual([]);
  });
});

describe("猜类型", () => {
  it("按说法猜", () => {
    expect(guessType("不要文绉绉的词")).toEqual({ type: "用词语感", level: "less" });
    expect(guessType("不写血腥过程")).toEqual({ type: "内容尺度", level: "brief" });
    expect(guessType("配角不降智").type).toBe("情节走向");
    expect(guessType("女主不哭").type).toBe("人物言行");
    expect(guessType("少用感叹号").type).toBe("格式标点");
  });
});

describe("提示词", () => {
  const ls = [
    L({ id: "a", text: "不要文绉绉的词", level: "less", cap: 2, words: ["伫立", "旋即"], who: { mode: "except", names: ["沈墨"], span: "dialog" } }),
    L({ id: "b", text: "不写血腥细节", type: "内容尺度", level: "brief" }),
    L({ id: "c", text: "暂停的", off: true }),
    L({ id: "d", text: "林渊不说脏话", type: "人物言行", who: { mode: "only", names: ["林渊"], span: "dialog" } }),
    L({ id: "e", text: "第二卷才管", vols: ["v2"] }),
  ];
  it("按类型分组，带力度、例子、人物例外，暂停的不带", () => {
    const b = limitsBlock(ls);
    expect(b).toContain("【用词语感】");
    expect(b).toContain("不要文绉绉的词（尽量少用，每千字最多 2 次；例如：伫立、旋即；例外：沈墨的对白可以用");
    expect(b).toContain("不写血腥细节（一笔带过）");
    expect(b).not.toContain("暂停的");
    expect(b).toContain("【限制】");
  });
  it("排大纲只带内容、情节、人物", () => {
    const b = limitsBlock(ls, "plan");
    expect(b).not.toContain("文绉绉");
    expect(b).toContain("血腥");
    expect(b).not.toContain("【限制】");
  });
  it("知道位置时，按卷和「只管这些人」筛", () => {
    expect(activeLimits(ls, "prose", { vol: "v1", names: ["苏晚"] }).map((l) => l.id)).toEqual(["a", "b"]);
    expect(activeLimits(ls, "prose", { vol: "v2", names: ["林渊"] }).map((l) => l.id)).toEqual(["a", "b", "d", "e"]);
    expect(activeLimits(ls).map((l) => l.id)).toEqual(["a", "b", "d", "e"]);
  });
  it("结尾提醒只列简称", () => {
    expect(limitsTail(ls)).toBe("写之前再核对一遍本书写作限制：不要文绉绉的词（尽量少用）（沈墨例外）；不写血腥细节（一笔带过）；林渊不说脏话（只管林渊）；第二卷才管。");
    expect(limitsTail([])).toBe("");
  });
});

describe("【限制】说明行", () => {
  it("从正文里拿出来", () => {
    expect(splitLimitNote("第一段\n第二段\n【限制】按限制只写了结果。")).toEqual({ body: "第一段\n第二段", notes: ["按限制只写了结果。"] });
    expect(splitLimitNote("正文")).toEqual({ body: "正文", notes: [] });
  });
});

describe("扫描", () => {
  it("绝不出现：出现就算", () => {
    const r = scanLimits("他嘴角勾起，又嘴角勾起。", [L({ id: "a", words: ["嘴角勾起"] })]);
    expect(r.hits.map((h) => h.from)).toEqual([1, 7]);
    expect(r.stats[0].over).toBe(true);
  });
  it("尽量少用：没超上限不标", () => {
    const l = L({ level: "less", cap: 2, words: ["伫立", "旋即", "良久"] });
    const short = "林渊伫立崖边。赵三旋即扑上来。" + "一".repeat(1000);
    expect(scanLimits(short, [l]).hits).toEqual([]);
    expect(scanLimits(short, [l]).stats[0].over).toBe(false);
    expect(scanLimits(short + "良久。", [l]).hits.length).toBe(3);
  });
  it("例外词不算，例外词包住的也不算", () => {
    const l = L({ words: ["遂"], except: ["遂心"] });
    expect(scanLimits("遂心如意，遂去。", [l]).hits.map((h) => h.from)).toEqual([5]);
  });
  it("暂停的不扫", () => {
    expect(scanLimits("嘴角勾起", [L({ words: ["嘴角勾起"], off: true })]).hits).toEqual([]);
  });
});

describe("对白归属", () => {
  const people = [
    { name: "沈墨", names: ["沈墨", "沈公子"] },
    { name: "林渊", names: ["林渊"] },
  ];
  it("按引号前后的名字认说话人", () => {
    const t = "沈墨折扇一合：“良久未见，旋即又别。”林渊看他一眼，“少废话。”\n“谁？”";
    const q = findQuotes(t, people);
    expect(q.map((x) => x.who)).toEqual(["沈墨", "林渊", null]);
    expect(findQuotes("“走吧。”沈公子道。", people)[0].who).toBe("沈墨");
  });
  it("除了沈墨：沈墨的对白不算，旁白和别人照算，认不出的标不确定", () => {
    const l = L({ id: "w", words: ["旋即"], who: { mode: "except", names: ["沈墨"], span: "dialog" } });
    const t = "沈墨道：“旋即便知。”林渊旋即转身。\n“旋即？”";
    const r = scanLimits(t, [l], { people });
    expect(r.hits.map((h) => [t.slice(h.from, h.to), !!h.unsure])).toEqual([
      ["旋即", false],
      ["旋即", true],
    ]);
    expect(r.stats[0].exempt).toBe(1);
    expect(r.stats[0].unsure).toBe(1);
  });
  it("例外的人设了尽量少用，超了也标", () => {
    const l = L({ id: "w", words: ["旋即"], who: { mode: "except", names: ["沈墨"], span: "dialog", level: "less" }, cap: 1 });
    const t = "沈墨道：“旋即，旋即，旋即。”";
    expect(scanLimits(t, [l], { people }).hits.length).toBe(3);
  });
  it("只管林渊：别人和旁白不算", () => {
    const l = L({ id: "c", words: ["混蛋"], who: { mode: "only", names: ["林渊"], span: "dialog" } });
    const t = "赵三骂：“混蛋！”林渊冷冷道：“混蛋。”旁白说他是混蛋。";
    const r = scanLimits(t, [l], { people: [...people, { name: "赵三", names: ["赵三"] }] });
    expect(r.hits.map((h) => h.who)).toEqual(["林渊"]);
  });
  it("视角叙述：span 为 pov 时，视角人物的旁白也放宽", () => {
    const l = L({ id: "w", words: ["凝眸"], who: { mode: "except", names: ["沈墨"], span: "pov" } });
    expect(scanLimits("他凝眸看去。", [l], { people, pov: "沈墨" }).hits).toEqual([]);
    expect(scanLimits("他凝眸看去。", [l], { people, pov: "林渊" }).hits.length).toBe(1);
  });
});

describe("这一次的要求冲突", () => {
  it("按核心词和预设的说法判断", () => {
    const gore = fromPreset("gore")!;
    const wen = fromPreset("wenzhou")!;
    expect(noteConflicts("打斗写得血腥一点", [gore, wen]).map((l) => l.text)).toEqual(["不写血腥细节"]);
    expect(noteConflicts("用古风文雅一点的语气", [gore, wen]).map((l) => l.text)).toEqual(["不要文绉绉的词"]);
    expect(noteConflicts("节奏放慢", [gore, wen])).toEqual([]);
    expect(coreOf("不写血腥细节")).toBe("血腥");
    expect(coreOf("不要文绉绉的词")).toBe("文绉绉");
  });
});

describe("只改这几处", () => {
  it("只替换含违反词的句子", () => {
    const t = "雾很大。林渊伫立崖边。赵三扑上来！\n他走了。";
    const hits = scanLimits(t, [L({ id: "a", words: ["伫立"] })]).hits;
    const bad = badSentences(t, hits);
    expect(bad.map((b) => b.t)).toEqual(["林渊伫立崖边。"]);
    expect(applySentenceFixes(t, bad, [{ i: 0, t: "林渊站在崖边。" }])).toBe("雾很大。林渊站在崖边。赵三扑上来！\n他走了。");
  });
  it("词表文本框分隔", () => {
    expect(parseWords("伫立、凝眸，旋即\n良久 伫立")).toEqual(["伫立", "凝眸", "旋即", "良久"]);
  });
});
