// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { AiRangeTrack, aiRangeNow, markAiRange } from "../../components/aiRange";

function make() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: [StarterKit, AiRangeTrack], content: "<p>第一段作者原文。</p><p>第二段要改写的。</p>" });
}

/** 第二段文字的位置 */
function second(ed: Editor) {
  const from = ed.state.doc.child(0).nodeSize + 1;
  return { from, to: from + ed.state.doc.child(1).content.size };
}

describe("H3 AI 生成期间继续写字，结果仍应用到原来选中的位置", () => {
  it("没记过位置时取不到", () => {
    const ed = make();
    expect(aiRangeNow(ed.state)).toBeNull();
    ed.destroy();
  });

  it("在前面一段打字：位置跟着挪，原文还在", () => {
    const ed = make();
    const s = second(ed);
    ed.view.dispatch(markAiRange(ed.state, s.from, s.to));
    ed.commands.insertContentAt(1, "新加的字");
    const r = aiRangeNow(ed.state)!;
    expect(r).toEqual({ from: s.from + 4, to: s.to + 4 });
    expect(ed.state.doc.textBetween(r.from, r.to)).toBe("第二段要改写的。");
    ed.destroy();
  });

  it("紧贴着原文前后打的字不算进原文", () => {
    const ed = make();
    const s = second(ed);
    ed.view.dispatch(markAiRange(ed.state, s.from, s.to));
    ed.commands.insertContentAt(s.to, "尾巴");
    ed.commands.insertContentAt(s.from, "开头");
    const r = aiRangeNow(ed.state)!;
    expect(ed.state.doc.textBetween(r.from, r.to)).toBe("第二段要改写的。");
    ed.destroy();
  });

  it("原文里面被改了：拒绝应用", () => {
    const ed = make();
    const s = second(ed);
    ed.view.dispatch(markAiRange(ed.state, s.from, s.to));
    ed.commands.insertContentAt(s.from + 2, "插");
    expect(aiRangeNow(ed.state)).toBeNull();
    ed.destroy();
  });

  it("全选改成一个字：拒绝应用，不会抛错", () => {
    const ed = make();
    const s = second(ed);
    ed.view.dispatch(markAiRange(ed.state, s.from, s.to));
    ed.commands.setContent("<p>短</p>");
    expect(aiRangeNow(ed.state)).toBeNull();
    ed.destroy();
  });

  it("记位置不进撤销记录", () => {
    const ed = make();
    const s = second(ed);
    ed.commands.insertContentAt(1, "甲");
    ed.view.dispatch(markAiRange(ed.state, s.from + 1, s.to + 1));
    ed.commands.undo();
    expect(ed.getText()).not.toContain("甲");
    // 撤销后位置也跟着挪回去
    const r = aiRangeNow(ed.state)!;
    expect(ed.state.doc.textBetween(r.from, r.to)).toBe("第二段要改写的。");
    ed.destroy();
  });
});
