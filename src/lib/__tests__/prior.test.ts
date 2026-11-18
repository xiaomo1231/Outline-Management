import { describe, expect, it, vi } from "vitest";

const texts = new Map<string, { id: string; plain: string; words: number; updated: number }>();
const arcs = new Map<string, { summary: string; end: string; facts: string[]; no: number; at: number; plain: string }>();

vi.mock("../repo", () => ({
  allTexts: async () => [...texts.values()],
  loadText: async (id: string) => texts.get(id) ?? null,
}));
vi.mock("../memory", () => ({
  items: async () => [],
  voteHit: async () => {},
  getBible: async () => ({ text: "", at: 0 }),
  getResident: async () => null,
}));
vi.mock("../ai/archive", async (orig) => ({ ...((await orig()) as object), archiveMap: async () => arcs }));

import { priorStory, CONTINUE_RULE } from "../ai/context";
import { diffSize, estimateCost } from "../ai/archive";

function ch(id: string, title: string, ol = "") {
  return { id, title, status: "已写", scenes: [], ol } as any;
}
const vols = [{ id: "v1", title: "第一卷", chapters: [ch("c1", "入城"), ch("c2", "被擒"), ch("c3", "押送", "主角被押往京城")] }] as any;
const c = { work: { id: "w" }, vols, chars: [{ name: "林舟", role: "男主", f: {} }, { name: "赵甲", role: "配角", f: {} }], events: [], plan: [], style: null, calls: [], changesets: [] } as any;

describe("前文", () => {
  it("读归档的摘要和章末状态，加上最近一章正文结尾和接上前文的规则", async () => {
    texts.set("c1", { id: "c1", plain: "林舟进了城。", words: 600, updated: 1 });
    texts.set("c2", { id: "c2", plain: "……赵甲和钱乙一左一右架着林舟，往城外走去。", words: 800, updated: 2 });
    arcs.set("c1", { summary: "林舟进城打探消息。", end: "林舟：在城里客栈", facts: [], no: 1, at: 1, plain: "林舟进了城。" });
    arcs.set("c2", { summary: "林舟被赵甲、钱乙擒住。", end: "林舟：被赵甲、钱乙押送出城，双手被缚", facts: [], no: 2, at: 2, plain: "……赵甲和钱乙一左一右架着林舟，往城外走去。" });
    const p = await priorStory(c, 3);
    expect(p.text).toContain("第1章 入城：林舟进城打探消息。");
    expect(p.text).toContain("第2章结束时的局面");
    expect(p.text).toContain("被赵甲、钱乙押送出城");
    expect(p.text).toContain("一左一右架着林舟");
    expect(p.text).toContain(CONTINUE_RULE);
    expect(p.names).toContain("赵甲");
  });
  it("归档之后结尾又改了，不用旧的章末状态，以原文为准", async () => {
    texts.set("c2", { id: "c2", plain: "林舟趁夜挣脱绳索，独自逃进了山里。", words: 800, updated: 3 });
    const p = await priorStory(c, 3);
    expect(p.text).not.toContain("结束时的局面");
    expect(p.text).toContain("逃进了山里");
  });
  it("上一章还没写，往前找最近写过的一章，并说明中间按大纲", async () => {
    vols[0].chapters.push(ch("c4", "京城"));
    const p = await priorStory(c, 4);
    expect(p.text).toContain("第3章 押送（还没写正文，按大纲）：主角被押往京城");
    expect(p.text).toContain("第2章正文结尾原文");
    expect(p.text).toContain("第3–3章还没写正文");
  });
  it("第一章没有前文", async () => {
    expect((await priorStory(c, 1)).text).toBe("");
  });
});

describe("归档比对", () => {
  it("只改几个字算小改动，大改算大改动", () => {
    const a = "林舟被押送出城。".repeat(50);
    expect(diffSize(a, a)).toBe(0);
    expect(diffSize(a, a.replace("押送", "押解"))).toBeLessThan(50);
    expect(diffSize(a, a + "他挣脱绳索逃进山里，赵甲在后面紧追不舍，钱乙去报信，城门很快关上了，全城开始搜捕。".repeat(2))).toBeGreaterThanOrEqual(50);
  });
  it("费用估算：一章 3000 字约一分钱", () => {
    const x = estimateCost([3000]);
    expect(x).toBeGreaterThan(0.003);
    expect(x).toBeLessThan(0.03);
  });
});
