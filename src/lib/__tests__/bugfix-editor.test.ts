// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AiEdit, AiText, AiTracker, AI_META, aiChars } from "../../components/aiMarks";
import { findInDoc, replaceInHtml } from "../findReplace";
import { loadInto } from "../editorText";
import { isShrink } from "../versions";
import { countWords, htmlToText } from "../util";

function mk(html = "") {
  const ed = new Editor({ element: document.createElement("div"), extensions: [StarterKit, AiText, AiEdit, AiTracker], content: "" });
  loadInto(ed as any, html);
  return ed;
}
const plainOf = (ed: Editor) => ed.getText({ blockSeparator: "\n" });

describe("M7 短章被覆盖也留快照", () => {
  it("453 字被全选覆盖成 1 字算骤降；删一两句不算", () => {
    expect(isShrink(453, 1)).toBe(true);
    expect(isShrink(100, 0)).toBe(true);
    expect(isShrink(40, 0)).toBe(false);
    expect(isShrink(600, 400)).toBe(false);
  });
});

describe("L10 AI 占比和本章字数同一口径", () => {
  it("英文、数字、引号、省略号、破折号不会让占比超过 100%", () => {
    const ed = mk('<p>作者写的开头。<span class="ai">Hello world 2024 AI.</span></p><p><span class="ai">“你好……”他说——AI写的一段。</span></p>');
    const [a, e] = aiChars(ed.state.doc);
    const words = countWords(plainOf(ed));
    expect(a + e).toBeLessThanOrEqual(words);
    expect(words - (a + e)).toBe(7);
    ed.destroy();
  });
  it("整章都是 AI 写的就是 100%", () => {
    const ed = mk('<p><span class="ai">AI 草稿第一段。</span></p><p><span class="ai">AI 草稿第二段。</span></p>');
    expect(aiChars(ed.state.doc)[0]).toBe(countWords(plainOf(ed)));
    ed.destroy();
  });
});

describe("L14 查找不跨软换行", () => {
  it("本章：好<br>的 不算「好的」，全部替换不删换行", () => {
    const ed = mk("<p>他说好<br>的我走了，好的。</p>");
    const hits = findInDoc(ed.state.doc, "好的");
    expect(hits).toHaveLength(1);
    expect(ed.state.doc.textBetween(hits[0].from, hits[0].to)).toBe("好的");
    ed.chain()
      .command(({ tr }) => {
        for (const h of [...hits].reverse()) tr.insertText("行吧", h.from, h.to);
        return true;
      })
      .run();
    expect(ed.getHTML()).toBe("<p>他说好<br>的我走了，行吧。</p>");
    ed.destroy();
  });
  it("全书：其他章的正文也不跨行替换，跨标记的整段替换保留换行", () => {
    expect(replaceInHtml("<p>他说好<br>的我走了</p>", "好的", "行吧")).toEqual({ html: "<p>他说好<br>的我走了</p>", n: 0 });
    const r = replaceInHtml('<p>他<span class="ai">说</span>好<br>的猫</p>', "他说", "她讲");
    expect(r.n).toBe(1);
    expect(r.html).toBe("<p>她讲好<br>的猫</p>");
    expect(htmlToText("<p>他说好<br>的我走了</p>")).toBe("他说好\n的我走了");
  });
});

describe("L15 AI 标记", () => {
  it("在 AI 段末回车另起一段，AI 字不变成「改过」", () => {
    const ed = mk('<p><span class="ai">AI写的一句话。</span></p>');
    const before = aiChars(ed.state.doc);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    ed.commands.splitBlock();
    expect(ed.state.doc.childCount).toBe(2);
    expect(aiChars(ed.state.doc)).toEqual(before);
    // 真的打字还是会变成「改过」
    ed.commands.insertContent("嗯");
    expect(aiChars(ed.state.doc)[0]).toBe(before[0]);
    ed.commands.setTextSelection(3);
    ed.commands.insertContent("嗯");
    expect(aiChars(ed.state.doc)[0]).toBe(0);
    ed.destroy();
  });
  it("撤销 AI 改写后，原来的 AI 字标记恢复", () => {
    const ed = mk('<p>他<span class="ai">缓缓</span>走进房间。</p>');
    expect(aiChars(ed.state.doc)).toEqual([2, 0]);
    // AI 扩写替换整段（带 AI_META，和写作页一样）
    ed.chain()
      .command(({ tr }) => {
        tr.setMeta(AI_META, true);
        return true;
      })
      .insertContentAt({ from: 0, to: ed.state.doc.content.size }, { type: "paragraph", content: [{ type: "text", text: "他慢慢地走进了房间。", marks: [{ type: "aitext" }] }] })
      .run();
    ed.commands.undo();
    expect(ed.getHTML()).toBe('<p>他<span class="ai">缓缓</span>走进房间。</p>');
    expect(aiChars(ed.state.doc)).toEqual([2, 0]);
    ed.destroy();
  });
});
