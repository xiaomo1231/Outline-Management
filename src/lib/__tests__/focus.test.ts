import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];
let jsonReply: unknown = {};
vi.mock("../repo", () => ({ getSetting: async (_k: string, fb: unknown) => fb, saveDoc: async () => {}, addUsage: async () => {}, getUsage: async () => [] }));
vi.mock("../memory", () => ({ getBible: async () => ({ text: "", at: 0 }), items: async () => [], voteHit: async () => {}, getResident: async () => null }));
vi.mock("../ai/client", async (orig) => ({
  ...((await orig()) as object),
  chat: async (msgs: { content: string }[]) => {
    sent.push(msgs.map((m) => m.content).join("\n----\n"));
    return { content: "正文写得很长。".repeat(800), toolCalls: [], usage: null };
  },
  chatJson: async (msgs: { content: string }[]) => {
    sent.push(msgs.map((m) => m.content).join("\n----\n"));
    return jsonReply;
  },
}));
vi.mock("../ai/context", async (orig) => ({
  ...((await orig()) as object),
  stablePrefix: async (_c: unknown, s: string) => s,
  priorStory: async () => ({ text: "", refs: [], names: [] }),
  chapterContext: async () => ({ text: "", refs: [] }),
}));

import { addChip, chipOn, cleanChips, DEFAULT_FOCUS_CHIPS, focusBlock, focusSummary, focusTail, removeChip, sceneWords } from "../focus";
import { fillChapter, selectionOp, splitScenes, suggestNext } from "../ai/tasks";
import { emptySetup } from "../style";
import type { Chapter, Scene } from "../types";

const sc = (t: string, p: Partial<Scene> = {}): Scene => ({ id: t, t, goal: "", conf: "", who: [], plant: "", pay: "", ...p });
const chap = (p: Partial<Chapter> = {}): Chapter => ({ id: "c1", title: "仰息", status: "写作中", scenes: [], ol: "风溟附身江彤云，一招击退修者。", ...p });
const ctxOf = (ch: Chapter) => ({ work: { id: "w", name: "书", intro: "", goal: 0, chapWords: 3000, created: 0, updated: 0 }, vols: [{ id: "v", title: "一", chapters: [ch] }], chars: [], events: [], plan: [], style: emptySetup(), calls: [], changesets: [] }) as any;
const ref = (ch: Chapter) => ({ v: 0, c: 0, no: 20, ch }) as any;
const FOCUS = "重点写风溟附身后的压迫感，交手写细";

beforeEach(() => {
  sent.length = 0;
  jsonReply = {};
});

describe("常用重点", () => {
  const fight = DEFAULT_FOCUS_CHIPS[0];
  it("点一下追加一句，再点一下去掉，不留多余分号", () => {
    const a = addChip("围观者多写", fight);
    expect(a).toBe("围观者多写；" + fight.text);
    expect(chipOn(a, fight)).toBe(true);
    expect(addChip(a, fight)).toBe(a);
    expect(removeChip(a, fight)).toBe("围观者多写");
    expect(removeChip(fight.text, fight)).toBe("");
  });
  it("自定义列表：去掉没名字的项，没写法时用名字；全删光就是空的", () => {
    expect(cleanChips([{ id: "a", label: " 打斗 ", text: "" }, { id: "b", label: "", text: "x" }])).toEqual([{ id: "a", label: "打斗", text: "打斗" }]);
    expect(cleanChips([])).toEqual([]);
    expect(cleanChips(undefined)).toBe(DEFAULT_FOCUS_CHIPS);
  });
});

describe("重点场景的字数分配", () => {
  it("没有重点场景时和以前一样平分，手填的不动", () => {
    expect(sceneWords([{}, {}, { words: 1000 }], 3000)).toEqual([1000, 1000, 1000]);
  });
  it("重点场景按两份分", () => {
    expect(sceneWords([{}, { key: true }, { key: true }, { key: true }, {}], 3000)).toEqual([375, 750, 750, 750, 375]);
  });
  it("手填的字数先扣掉，剩下的再按份分", () => {
    expect(sceneWords([{ words: 1000 }, { key: true }, {}], 3000)).toEqual([1000, 1333, 667]);
  });
});

describe("提示词", () => {
  it("没有写作重点时为空", () => {
    expect(focusBlock(chap())).toBe("");
    expect(focusTail(chap())).toBe("");
    expect(focusSummary(chap())).toBe("");
  });
  it("写作重点和重点场景都进提示词", () => {
    const ch = chap({ focus: FOCUS, scenes: [sc("修者逼近"), sc("附身出手", { key: true })] });
    const b = focusBlock(ch);
    expect(b).toContain("本章写作重点");
    expect(b).toContain(FOCUS);
    expect(b).toContain("场景2「附身出手」");
    expect(b).toContain("以限制为准");
    expect(focusTail(ch)).toContain(FOCUS);
    expect(focusSummary(ch)).toBe(FOCUS + "；重点场景 「附身出手」");
  });

  it("整章生成：完整版和末尾提醒都在", async () => {
    await fillChapter(ctxOf(chap({ focus: FOCUS })), ref(chap({ focus: FOCUS })), () => {}, () => {});
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("=== 本章写作重点（作者指定）===");
    expect(sent[0].trim().split("\n").pop()).toContain("本章写作重点：" + FOCUS);
  });
  it("分场景生成：重点场景字数加倍，并提醒这是重点场景", async () => {
    const ch = chap({ focus: FOCUS, scenes: [sc("甲"), sc("乙", { key: true }), sc("丙")] });
    await fillChapter(ctxOf(ch), ref(ch), () => {}, () => {});
    expect(sent).toHaveLength(3);
    expect(sent[0]).toContain("约 750 字");
    expect(sent[1]).toContain("约 1500 字");
    expect(sent[1]).toContain("这是本章的重点场景");
    expect(sent[2]).not.toContain("这是本章的重点场景");
    expect(sent.every((x) => x.includes(FOCUS))).toBe(true);
  });
  it("接着已有正文写：也带上", async () => {
    const ch = chap({ focus: FOCUS });
    await fillChapter(ctxOf(ch), ref(ch), () => {}, () => {}, undefined, "已经写好的开头。");
    expect(sent[0]).toContain("=== 本章写作重点");
  });
  it("没写重点时，请求里一个字都不多", async () => {
    const ch = chap({ scenes: [sc("甲"), sc("乙"), sc("丙")] });
    await fillChapter(ctxOf(ch), ref(ch), () => {}, () => {});
    expect(sent.some((x) => x.includes("写作重点") || x.includes("重点场景"))).toBe(false);
    expect(sent[0]).toContain("约 1000 字");
  });
  it("续写、扩写带；润色、缩写不带", async () => {
    const ch = chap({ focus: FOCUS });
    for (const op of ["续写", "扩写", "润色", "缩写", "改写"]) await selectionOp(ctxOf(ch), ref(ch), op, "原文一段。", "前文。", () => {});
    expect(sent.map((x) => x.includes(FOCUS))).toEqual([true, true, false, false, false]);
  });
  it("Ctrl+Enter 带一句简版，不带篇幅规则", async () => {
    jsonReply = { options: [] };
    const ch = chap({ focus: FOCUS });
    await suggestNext(ctxOf(ch), ref(ch), "前文");
    expect(sent[0]).toContain(FOCUS);
    expect(sent[0]).not.toContain("一半以上的篇幅");
  });
  it("拆场景：带上重点，AI 标的重点场景保留", async () => {
    jsonReply = { scenes: [{ t: "交手", goal: "", conf: "", who: [], key: true }, { t: "回城", goal: "", conf: "", who: [], key: false }] };
    const ch = chap({ focus: FOCUS });
    const out = await splitScenes(ctxOf(ch), "一句话", ref(ch));
    expect(sent[0]).toContain(FOCUS);
    expect(out.map((s) => !!s.key)).toEqual([true, false]);
  });
});
