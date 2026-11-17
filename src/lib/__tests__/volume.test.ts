import { describe, expect, it } from "vitest";
import { applyVolumeSplit, newChapter } from "../outline";
import type { StoryEvent, Volume } from "../types";

const sc = (t: string) => ({ t, goal: "g", conf: "c", who: ["甲"] });

describe("卷大纲拆成逐章大纲", () => {
  it("先填已有的空章，不够再新建，新场景自动进时间线", () => {
    const mine = { ...newChapter("自己起的章名"), ol: "作者写的大纲" };
    const vols: Volume[] = [{ id: "v1", title: "第一卷", chapters: [mine, newChapter("")] }];
    const events: StoryEvent[] = [];
    const r = applyVolumeSplit(vols, events, 0, [
      { t: "AI 章名一", ol: "AI 大纲一", scenes: [sc("一-1"), sc("一-2")] },
      { t: "AI 章名二", ol: "AI 大纲二", hook: "钩子", scenes: [sc("二-1")] },
      { t: "AI 章名三", ol: "AI 大纲三", scenes: [sc("三-1")] },
    ]);
    const chs = vols[0].chapters;
    expect(chs).toHaveLength(3);
    expect(chs[0].title).toBe("自己起的章名");
    expect(chs[0].ol).toBe("作者写的大纲");
    expect(chs[1].title).toBe("AI 章名二");
    expect(chs[1].hook).toBe("钩子");
    expect(chs[2].ol).toBe("AI 大纲三");
    expect(r).toEqual({ filled: 2, added: 1, scenes: 4 });
    expect(events).toHaveLength(4);
    expect(chs.flatMap((c) => c.scenes).every((s) => s.ev && events.some((e) => e.id === s.ev && e.sc === s.id))).toBe(true);
  });

  it("已经有场景的章不再加场景；可以不进时间线", () => {
    const ch = newChapter("有场景的章");
    ch.scenes.push({ id: "s0", t: "原有场景", goal: "", conf: "", who: [], plant: "", pay: "" });
    const vols: Volume[] = [{ id: "v1", title: "第一卷", chapters: [ch] }];
    const events: StoryEvent[] = [];
    applyVolumeSplit(vols, events, 0, [{ t: "x", ol: "补上的大纲", scenes: [sc("不该加")] }], false);
    expect(vols[0].chapters[0].scenes.map((s) => s.t)).toEqual(["原有场景"]);
    expect(vols[0].chapters[0].ol).toBe("补上的大纲");
    expect(events).toHaveLength(0);
  });
});
