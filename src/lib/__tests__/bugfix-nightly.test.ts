import { beforeEach, describe, expect, it, vi } from "vitest";

// 内存里的假数据：日志、设定集、核心摘要、日记
const st = vi.hoisted(() => ({
  log: [] as any[],
  bible: { text: "", at: 0 } as any,
  resident: null as any,
  diary: new Map<string, string>(),
  replies: [] as string[],
  prompts: [] as string[],
  arcs: new Map<string, any>(),
  daily: [] as any[],
}));

vi.mock("../ai/client", async (orig) => ({
  ...((await orig()) as object),
  chat: async (msgs: { content: string }[]) => {
    st.prompts.push(msgs[msgs.length - 1].content);
    return { content: st.replies.shift() ?? "", toolCalls: [], usage: null };
  },
}));
vi.mock("../repo", () => ({
  allTexts: async () => [],
  dailyWords: async () => st.daily,
  saveDiary: async (_w: string, day: string, t: string) => void st.diary.set(day, t),
}));
vi.mock("../ai/archive", () => ({
  stale: async () => [],
  archiveMany: async () => ({ ok: 0, failed: 0 }),
  archiveMap: async () => st.arcs,
}));
vi.mock("../memory", async (orig) => {
  const real = (await orig()) as any;
  return {
    ...real,
    getLog: async () => st.log,
    appendLog: async (_w: string, e: any) => void st.log.unshift(e),
    items: async () => [],
    getBible: async () => st.bible,
    saveBible: async (_w: string, text: string, upto?: number) => void (st.bible = { text, at: Date.now(), upto: upto ?? st.bible.upto ?? st.bible.at }),
    saveResident: async (_w: string, text: string) => void (st.resident = text),
    scriptRun: async () => ({}),
  };
});

import { modelRun } from "../ai/nightly";
import { emptySetup } from "../style";
import { today } from "../util";
import { useStore } from "../store";

const c = { work: { id: "w", name: "书", intro: "" }, vols: [{ id: "v", title: "一", chapters: [{ id: "c1", title: "甲", status: "已写", scenes: [] }] }], chars: [], events: [], plan: [], style: emptySetup(), calls: [], changesets: [] } as any;

beforeEach(() => {
  useStore.setState({ work: c.work, vols: c.vols, chars: [] });
  st.log = [{ at: Date.now(), day: today(), kind: "script", ok: true, lines: [] }];
  st.bible = { text: "【世界规则】灵气复苏", at: 0 };
  st.resident = null;
  st.diary.clear();
  st.replies = [];
  st.prompts = [];
  st.arcs = new Map([["c1", { summary: "第一章摘要", at: 1000, end: "", facts: [], no: 1, plain: "" }]]);
  st.daily = [];
});

describe("M26 AI 返回空内容时不覆盖", () => {
  it("设定集、核心摘要、日记返回空：原样保留，日志记失败", async () => {
    st.resident = "旧摘要";
    st.replies = ["", "", ""];
    const e = await modelRun(c, 1000);
    expect(st.bible.text).toBe("【世界规则】灵气复苏");
    expect(st.resident).toBe("旧摘要");
    expect(st.diary.size).toBe(0);
    expect(e.ok).toBe(false);
    expect(e.lines.join("\n")).not.toContain("设定集已更新");
  });
  it("正常返回时照常保存", async () => {
    st.replies = ["日记", "摘要", "【世界规则】灵气复苏\n【人物定论】张三是捕快"];
    const e = await modelRun(c, 1000);
    expect(e.ok).toBe(true);
    expect(st.bible.text).toContain("张三是捕快");
  });
});

describe("M32 作者手动保存设定集后，白天归档的章照样提炼", () => {
  it("用 upto 而不是保存时间筛选", async () => {
    // 上次 AI 提炼到 500，作者之后在 2000 手动保存过
    st.bible = { text: "旧设定", at: 2000, upto: 500 };
    st.replies = ["日记", "摘要", "新设定"];
    await modelRun(c, 1000);
    expect(st.prompts[2]).toContain("第1章：第一章摘要");
    expect(st.bible.text).toBe("新设定");
    expect(st.bible.upto).toBeGreaterThan(1000);
  });
});

describe("M30 补跑时日记写到漏掉的那天", () => {
  it("按结账日统计字数、存日记", async () => {
    st.daily = [{ day: today(), words: 5 }, { day: "2026-01-02", words: 3000 }];
    st.replies = ["那天的日记", "摘要", "设定"];
    await modelRun(c, 1000, undefined, "2026-01-02");
    expect(st.prompts[0]).toContain("2026-01-02写了 3000 字");
    expect(st.diary.get("2026-01-02")).toBe("那天的日记");
    expect(st.diary.has(today())).toBe(false);
  });
});
