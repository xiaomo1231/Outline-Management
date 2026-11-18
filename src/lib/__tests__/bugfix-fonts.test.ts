// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// 用内存代替 IndexedDB，网页版（非 Tauri）
const store = new Map<string, Uint8Array>();
vi.mock("../db", () => ({
  isTauri: false,
  idbGet: async (k: string) => store.get(k),
  idbPut: async (k: string, v: Uint8Array) => void store.set(k, v),
}));

const added: string[] = [];
class FakeFace {
  constructor(public family: string, public data: ArrayBuffer) {}
  async load() {
    return this;
  }
}

beforeEach(() => {
  store.clear();
  added.length = 0;
  (globalThis as any).FontFace = FakeFace;
  Object.defineProperty(document, "fonts", { configurable: true, value: { add: (f: FakeFace) => added.push(f.family), [Symbol.iterator]: () => added.map((family) => ({ family }))[Symbol.iterator]() } });
});

describe("L20 网页版导入的字体刷新后还在", () => {
  it("导入时存进 IndexedDB 并给出路径，启动时按路径重新注册", async () => {
    const { importFont, loadSavedFonts } = await import("../fonts");
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = realCreate(tag) as HTMLInputElement;
      if (tag === "input") {
        const file = new File([new Uint8Array([1, 2, 3])], "TestFont.ttf");
        Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
        Object.defineProperty(el, "files", { value: [file] });
        el.click = () => void el.onchange?.(new Event("change"));
      }
      return el;
    }) as any);
    const f = await importFont();
    vi.restoreAllMocks();
    expect(f?.name).toBe("导入·TestFont");
    expect(f?.path).toBeTruthy();
    expect(added).toEqual(["导入·TestFont"]);

    // 模拟刷新：已注册的字体清空，按存下的列表重新加载
    added.length = 0;
    await loadSavedFonts([f!]);
    expect(added).toEqual(["导入·TestFont"]);
    // 已经装上的不重复注册
    await loadSavedFonts([f!]);
    expect(added).toEqual(["导入·TestFont"]);
  });

  it("库里找不到的字体跳过，不报错", async () => {
    const { loadSavedFonts } = await import("../fonts");
    await loadSavedFonts([{ name: "导入·没了", path: "idb:font:导入·没了" }, { name: "导入·老数据", path: "" }]);
    expect(added).toEqual([]);
  });
});
