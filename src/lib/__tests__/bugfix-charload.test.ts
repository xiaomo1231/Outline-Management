import { describe, expect, it, vi } from "vitest";

const bad = [{ id: "p1", name: "张三", f: { id: "农夫" }, changes: [{ id: "cc1", ch: "c1", field: "id", from: "农夫", to: { 职位: "队长" }, cause: ["升", 3], quote: null, by: "ai", at: 1, status: "applied" }] }];
vi.mock("../repo", () => ({
  listWorks: async () => [{ id: "w1", title: "书" }],
  loadDoc: async (_w: string, kind: string, fb: unknown) => (kind === "chars" ? JSON.parse(JSON.stringify(bad)) : fb),
  getSetting: async (_k: string, fb: unknown) => fb,
  setSetting: async () => {},
  saveDoc: async () => {},
}));

import { useStore, tidyChars } from "../store";

describe("M28 老数据里人设变化 to 是对象", () => {
  it("载入作品时把人设变化各字段规整成字符串", async () => {
    await useStore.getState().openWork("w1");
    const x = useStore.getState().chars[0].changes![0];
    expect(x.to).toBe("队长");
    expect(x.cause).toBe("升，3");
    expect(x.quote ?? "").toBe("");
    expect(x.from).toBe("农夫");
  });
  it("撤销回来的旧快照也规整", () => {
    useStore.setState({ chars: [], changesets: [{ id: "cs1", at: 1, label: "归档", before: { chars: bad } } as any] });
    useStore.getState().undoChange("cs1");
    expect(useStore.getState().chars[0].changes![0].to).toBe("队长");
  });
  it("正常数据原样返回，不复制", () => {
    const ok = [{ id: "p", name: "李四", f: {}, changes: [{ id: "c", ch: "c1", field: "id", from: "", to: "县令", cause: "", by: "ai", at: 1, status: "applied" }] }] as any;
    expect(tidyChars(ok)[0]).toBe(ok[0]);
  });
});
