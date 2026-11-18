import { describe, expect, it, vi } from "vitest";

let reply: unknown = {};
vi.mock("../repo", () => ({ getSetting: async (_k: string, fb: unknown) => fb, saveDoc: async () => {}, addUsage: async () => {}, getUsage: async () => [] }));
vi.mock("../memory", () => ({ getBible: async () => ({ text: "", at: 0 }), items: async () => [], voteHit: async () => {}, getResident: async () => null }));
vi.mock("../ai/client", async (orig) => ({ ...((await orig()) as object), chatJson: async () => reply, chat: async () => ({ content: "", toolCalls: [], usage: null }) }));
vi.mock("../ai/context", async (orig) => ({
  ...((await orig()) as object),
  stablePrefix: async (_c: unknown, s: string) => s,
  priorStory: async () => ({ text: "", refs: [], names: [] }),
  chapterContext: async () => ({ text: "", refs: [] }),
}));

import { useStore } from "../store";
import { emptySetup } from "../style";
import { splitScenes, suggestNext, SEL_OPS } from "../ai/tasks";

describe("M29 / M36 整组撤销：先撤旧的再撤新的", () => {
  it("撤销旧组时把之后动过同一份数据的组一起标成已撤销，不会复活", () => {
    useStore.setState({ chars: [{ name: "张三", f: {} }] as any, vols: [], events: [], changesets: [] });
    const s = useStore.getState();
    s.aiEdit("A", ["chars"], (d) => void ((d.chars[0] as any).f.id = "捕快"));
    s.aiEdit("B", ["chars"], (d) => void ((d.chars[0] as any).f.id = "县令"));
    s.aiEdit("C", ["events"], (d) => void d.events.push({ id: "e1" } as any));
    const [c, b, a] = useStore.getState().changesets;
    useStore.getState().undoChange(a.id);
    let st = useStore.getState();
    expect((st.chars[0] as any).f.id).toBeUndefined();
    expect(st.changesets.find((x) => x.id === b.id)?.undone).toBe(true);
    // 没动 chars 的组不受影响
    expect(st.changesets.find((x) => x.id === c.id)?.undone).toBeFalsy();
    expect(st.events.length).toBe(1);
    useStore.getState().undoChange(b.id);
    st = useStore.getState();
    expect((st.chars[0] as any).f.id).toBeUndefined();
  });
  it("两次存为场景，先撤甲再撤乙，甲不会冒出来", () => {
    useStore.setState({ vols: [{ id: "v", title: "一", chapters: [{ id: "c", title: "", status: "大纲", scenes: [] }] }] as any, changesets: [] });
    const s = useStore.getState();
    s.aiEdit("甲", ["vols"], (d) => void d.vols[0].chapters[0].scenes.push({ t: "甲" } as any));
    s.aiEdit("乙", ["vols"], (d) => void d.vols[0].chapters[0].scenes.push({ t: "乙" } as any));
    const [yi, jia] = useStore.getState().changesets;
    useStore.getState().undoChange(jia.id);
    useStore.getState().undoChange(yi.id);
    const st = useStore.getState();
    expect(st.vols[0].chapters[0].scenes).toEqual([]);
    expect(st.changesets.every((x) => x.undone)).toBe(true);
  });
  it("后来的组跨了别的数据，也按最早的 before 一起回退", () => {
    useStore.setState({ vols: [{ id: "v", title: "一", chapters: [] }] as any, events: [], changesets: [] });
    const s = useStore.getState();
    s.aiEdit("A", ["vols"], (d) => void (d.vols[0].title = "A"));
    s.aiEdit("B", ["vols", "events"], (d) => {
      d.vols[0].title = "B";
      d.events.push({ id: "e" } as any);
    });
    const [, a] = useStore.getState().changesets;
    useStore.getState().undoChange(a.id);
    const st = useStore.getState();
    expect(st.vols[0].title).toBe("一");
    expect(st.events).toEqual([]);
  });
});

describe("L47 模型返回的字段规整", () => {
  const c = { work: { id: "w" }, vols: [{ id: "v", title: "一", chapters: [{ id: "c", title: "甲", status: "大纲", scenes: [] }] }], chars: [], events: [], plan: [], style: emptySetup(), calls: [], changesets: [] } as any;
  const r = { v: 0, c: 0, no: 1, ch: c.vols[0].chapters[0] } as any;
  it("who 是字符串时拆成数组", async () => {
    reply = { scenes: [{ t: "天台相见", goal: "见面", conf: "误会", who: "林舟、苏晚" }, { t: "二", who: null }] };
    const out = await splitScenes(c, "一句话", r);
    expect(out[0].who).toEqual(["林舟", "苏晚"]);
    expect(out[1].who).toEqual([]);
  });
  it("接下来怎么写：缺 t 的选项丢掉", async () => {
    reply = { options: [{ d: "没有正文" }, { t: "他推开门。", d: "动作" }, null] };
    expect(await suggestNext(c, r, "前文")).toEqual([{ t: "他推开门。", d: "动作" }]);
  });
});

describe("M35 选中文字菜单有缩写和换说法", () => {
  it("SEL_OPS 里有这两项", () => {
    expect(Object.keys(SEL_OPS)).toEqual(expect.arrayContaining(["缩写", "换说法"]));
  });
});
