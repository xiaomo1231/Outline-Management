// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { countIn, replaceInHtml, snippets } from "../findReplace";

describe("查找替换", () => {
  it("数命中", () => {
    expect(countIn("林舟看着林舟", "林舟")).toBe(2);
    expect(countIn("abc", "")).toBe(0);
  });
  it("替换正文 HTML，不动标签", () => {
    const r = replaceInHtml('<p>林舟说话。</p><p><span class="ai">林</span>舟走了，林舟。</p>', "林舟", "沈舟");
    expect(r.n).toBe(3);
    expect(r.html).toContain("沈舟说话");
    expect(r.html).not.toContain("林舟");
  });
  it("片段", () => {
    expect(snippets("一二三四五六七八九十林舟", "林舟")[0]).toContain("林舟");
  });
});
