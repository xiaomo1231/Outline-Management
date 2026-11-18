// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ resident: null as any }));
vi.mock("../memory", async (orig) => {
  const real = (await orig()) as any;
  return { ...real, getResident: async () => st.resident, items: async () => [] };
});
vi.mock("../repo", async (orig) => ({ ...((await orig()) as object), getSetting: async (_k: string, d: unknown) => d }));

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BUILTIN, compileStyle, emptySetup, fuse, normDims, normDraft } from "../style";
import { PATTERNS, scan } from "../aiscan";
import { cnToNum } from "../util";
import { describe as describeChar, hiddenAt, renameRefs, snapshot } from "../chars";
import { styleSig } from "../memory";
import { resident } from "../ai/context";
import { ScanHighlight, scanKey } from "../../components/scanDeco";
import type { Character, StyleBlock, Volume } from "../types";

describe("H4 AI 只回一句话、没有风格草稿", () => {
  it("缺 dims、缺 name：规整成完整结构，不抛错", () => {
    const d = normDraft({ reply: "你想要偏冷还是偏暖的语感？" });
    expect(d.reply).toBe("你想要偏冷还是偏暖的语感？");
    expect(d.name).toBe("新风格");
    expect(d.desc).toBe("全篇");
    expect(d.dims).toEqual({ pov: "", lang: "", vocab: "", rhythm: "", dialog: "", tone: "", avoid: "" });
    expect(d.name.trim()).toBe("新风格");
  });
  it("拆书时 AI 返回缺 name，用给的默认名", () => {
    expect(normDraft({ dims: { tone: "冷" } }, "拆书风格").name).toBe("拆书风格");
  });
  it("返回的不是对象（字符串、null、数组）也不抛错", () => {
    expect(normDraft("好的").reply).toBe("好的");
    expect(normDraft(null).dims.pov).toBe("");
    expect(normDraft([1, 2]).name).toBe("新风格");
  });
});

describe("L34 「避免」是数组", () => {
  it("规整成顿号分隔的字符串", () => {
    expect(normDims({ avoid: ["排比", "感叹号"], tone: 3 })).toMatchObject({ avoid: "排比、感叹号", tone: "3", pov: "" });
  });
  it("老数据里存成数组的块也能按规则合并", () => {
    const bad = { id: "x", kind: "custom", name: "冷峻", desc: "全篇", dims: { ...normDims({}), tone: "冷", avoid: ["排比", "感叹号"] as any } } as StyleBlock;
    const dushi = BUILTIN.find((b) => b.id === "dushi")!;
    const f = fuse([bad, dushi], "合");
    expect(f.dims.avoid).toContain("排比");
    expect(f.dims.avoid).toContain("感叹号");
  });
});

describe("L32 「不是……，而是……」", () => {
  const n = (t: string) => scan(t).find((r) => r.label === "不是……而是……")?.n ?? 0;
  it("中间带逗号也算", () => {
    expect(n("这不是结束，而是开始。")).toBe(1);
    expect(n("这不是结束，而是开始。不是你的错而是我的。")).toBe(2);
  });
  it("不跨段", () => {
    expect(n("他说不是\n而是我")).toBe(0);
  });
  it("提示词里列为套话", () => {
    expect(PATTERNS.some((p) => p.label === "不是……而是……")).toBe(true);
  });
});

describe("M22 套话跨过加粗、AI 标记时也要标出来", () => {
  it("「一口」加粗后「深吸一口气」整个高亮", () => {
    const ed = new Editor({ element: document.createElement("div"), extensions: [StarterKit, ScanHighlight], content: "<p>他深吸<strong>一口</strong>气。</p><p>这不是结束，<em>而是</em>开始。</p>" });
    ed.view.dispatch(ed.state.tr.setMeta(scanKey, true));
    const hits = [...ed.view.dom.querySelectorAll(".cliche")].map((x) => x.textContent).join("|");
    expect(hits).toContain("深吸");
    expect(hits).toContain("一口");
    expect(hits).toContain("气");
    expect(hits).toContain("不是结束，");
    expect(hits).toContain("而是");
    ed.destroy();
  });
});

const vols: Volume[] = [{ id: "v", title: "一", chapters: [1, 2, 3].map((i) => ({ id: "c" + i, title: "第" + i + "章", status: "已写", scenes: [] }) as any) }];
const char = (over: Partial<Character> = {}): Character => ({ id: "p", role: "主角", name: "张三", f: { id: "农夫" }, ...over }) as Character;

describe("L24 计划揭示章写成中文数字", () => {
  it("cnToNum", () => {
    expect([cnToNum("十"), cnToNum("二十五"), cnToNum("一百零五"), cnToNum("两千"), cnToNum("三")]).toEqual([10, 25, 105, 2000, 3]);
    expect(cnToNum("甲")).toBeNaN();
  });
  it("「第十章」到第 10 章起揭示", () => {
    const c = char({ f: { secret: "其实是皇子" }, rev: { secret: { s: "未揭示", ch: "第十章" } } as any });
    expect(hiddenAt(c, "secret", 9)).toBe(true);
    expect(hiddenAt(c, "secret", 10)).toBe(false);
    expect(hiddenAt(c, "secret", 20)).toBe(false);
    expect(hiddenAt(char({ rev: { secret: { s: "未揭示", ch: "第10章" } } as any }), "secret", 10)).toBe(false);
    expect(hiddenAt(char({ rev: { secret: { s: "未揭示", ch: "" } } as any }), "secret", 99)).toBe(true);
  });
});

describe("M18 人设变化挂的章已经删了", () => {
  it("不生效，不会从第 1 章起就变", () => {
    const c = char({ changes: [{ id: "x", ch: "gone", field: "id", from: "农夫", to: "鬼魂", cause: "", by: "author", at: 1, status: "applied" }] as any });
    expect(snapshot(c, vols, 1).id).toBe("农夫");
    expect(snapshot(c, vols, 3).id).toBe("农夫");
    expect(describeChar(c, vols, 1)).not.toContain("鬼魂");
  });
  it("章还在时照常生效", () => {
    const c = char({ changes: [{ id: "x", ch: "c2", field: "id", from: "农夫", to: "鬼魂", cause: "", by: "author", at: 1, status: "applied" }] as any });
    expect(snapshot(c, vols, 1).id).toBe("农夫");
    expect(snapshot(c, vols, 2).id).toBe("鬼魂");
  });
});

describe("M21 人物改名", () => {
  const data = () => ({
    chars: [char({ name: "张三丰" }), char({ id: "q", name: "李四" })],
    vols: [{ id: "v", title: "一", chapters: [{ id: "c1", title: "", status: "", scenes: [{ id: "s", t: "", who: ["张三", "李四"], pov: "张三" }] }] }] as any as Volume[],
    events: [{ id: "e", day: 1, ch: null, t: "", who: "张三、李四", ty: "main" }] as any,
    calls: [{ from: "张三", to: "李四", term: "四哥" }, { from: "李四", to: "张三", term: "三哥" }],
    limits: [{ id: "l", text: "", type: "人物言行", level: "never", words: [], except: [], who: { mode: "only", names: ["张三"], span: "dialog" } }] as any,
  });
  it("称呼表、场景出场人物和视角、事件人物、限制管的人一起改", () => {
    const d = data();
    renameRefs(d, "张三", "张三丰");
    expect(d.calls).toEqual([{ from: "张三丰", to: "李四", term: "四哥" }, { from: "李四", to: "张三丰", term: "三哥" }]);
    expect(d.vols[0].chapters[0].scenes[0].who).toEqual(["张三丰", "李四"]);
    expect(d.vols[0].chapters[0].scenes[0].pov).toBe("张三丰");
    expect(d.events[0].who).toBe("张三丰、李四");
    expect(d.limits[0].who.names).toEqual(["张三丰"]);
  });
  it("改成空名字、别人还叫旧名字时不动", () => {
    const d = data();
    renameRefs(d, "张三", "");
    expect(d.calls[0].from).toBe("张三");
    const d2 = data();
    d2.chars.push(char({ id: "r", name: "张三" }));
    renameRefs(d2, "张三", "张三丰");
    expect(d2.calls[0].from).toBe("张三");
  });
});

describe("M24 改了风格后核心摘要里的旧写作规范", () => {
  const ctx = (rules: string) => ({ work: { id: "w", name: "书", intro: "" }, vols, chars: [], events: [], plan: [], style: { ...emptySetup(), rules }, calls: [], changesets: [] }) as any;
  beforeEach(() => (st.resident = null));
  it("风格没改：用存好的摘要", async () => {
    st.resident = { text: "存好的摘要", at: 1, limit: 1000, style: styleSig(compileStyle(ctx("用第一人称写").style)) };
    expect(await resident(ctx("用第一人称写"))).toBe("存好的摘要");
  });
  it("「我的规则」改了：不再用旧摘要，现场按新规则拼", async () => {
    st.resident = { text: "写作规范：用第一人称写", at: 1, limit: 1000, style: styleSig(compileStyle(ctx("用第一人称写").style)) };
    const r = await resident(ctx("用第三人称写，绝不用第一人称"));
    expect(r).not.toContain("用第一人称写\n");
    expect(r).not.toBe("写作规范：用第一人称写");
    expect(r).toContain("用第三人称写，绝不用第一人称");
  });
  it("只改样章不算改了写作规范", () => {
    expect(styleSig("规则\n【作者样章，模仿】甲")).toBe(styleSig("规则\n【作者样章，模仿】乙"));
  });
});
