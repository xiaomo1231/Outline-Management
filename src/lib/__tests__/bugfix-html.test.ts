// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { replaceInHtml } from "../findReplace";
import { cleanHtml, htmlToText } from "../util";

describe("M41 正文 HTML 只当数据处理，不执行脚本", () => {
  it("全书替换和取纯文字不会触发 onerror", async () => {
    const w = window as any;
    w.__n = 0;
    const html = '<p>甲</p><img src="x" onerror="window.__n++"><script>window.__n++</script>';
    const r = replaceInHtml(html, "甲", "乙");
    expect(r.n).toBe(1);
    expect(htmlToText(r.html)).toContain("乙");
    await new Promise((res) => setTimeout(res, 50));
    expect(w.__n).toBe(0);
  });

  it("导入作品包时清洗：去掉 script、on* 属性、javascript: 链接，正文和 AI 标记保留", () => {
    const html =
      '<p>正<span data-ai="1" class="ai">文</span></p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href=" java\nscript:alert(1)">链</a><iframe src="https://x"></iframe><p onclick="alert(1)">二</p>';
    const out = cleanHtml(html);
    expect(out).not.toMatch(/script|onerror|onclick|iframe/i);
    expect(out).toContain('<span data-ai="1" class="ai">文</span>');
    expect(out).toContain("<a>链</a>");
    expect(htmlToText(out)).toBe("正文\n链二");
  });
});
