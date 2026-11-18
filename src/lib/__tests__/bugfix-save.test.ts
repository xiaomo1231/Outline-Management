import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({ fail: false, texts: new Map<string, string>(), writes: 0 }));

vi.mock("../repo", () => ({
  loadText: async (id: string) => (st.texts.has(id) ? { html: st.texts.get(id), plain: "", words: 3, ai_chars: 0, updated: 0 } : null),
  saveText: async (_w: string, id: string, html: string) => {
    st.writes++;
    if (st.fail) throw new Error("disk I/O error");
    st.texts.set(id, html);
    return 0;
  },
  latestVersion: async () => ({ at: Date.now(), words: 3, html: "x" }),
  addVersion: async () => {},
  saveWork: async () => {},
  saveDoc: async () => {},
}));

import { trackSave, useStore } from "../store";
import { persistChapter } from "../chapterSave";

const snap = (html: string) => ({ html, plain: html, words: 3, ai: 0 });

describe("M10 保存失败后重试", () => {
  beforeEach(() => {
    st.fail = false;
    st.texts.clear();
    st.writes = 0;
  });

  it("别的内容存成功不会把正文的失败抹掉；点重试马上重存正文", async () => {
    st.fail = true;
    await expect(persistChapter("w", "c1", snap("<p>失败期间打的字</p>"))).rejects.toThrow();
    expect(useStore.getState().saveErr).toBeTruthy();
    // 改章名之类的保存成功了，正文还没存进去
    await trackSave(async () => 1, "doc:vols");
    expect(useStore.getState().saveErr).toBeTruthy();
    // 数据库恢复后点「保存失败，点此重试」
    st.fail = false;
    const n = st.writes;
    await useStore.getState().flushSaves();
    expect(st.writes).toBe(n + 1);
    expect(st.texts.get("c1")).toBe("<p>失败期间打的字</p>");
    expect(useStore.getState().saveErr).toBeNull();
  });
});
