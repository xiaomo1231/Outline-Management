// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { loadInto } from "../editorText";

describe("切章", () => {
  it("载入新一章后按撤销，不会退回上一章的正文", () => {
    const updates: string[] = [];
    const ed = new Editor({ element: document.createElement("div"), extensions: [StarterKit], content: "", onUpdate: ({ editor }) => updates.push(editor.getText()) });
    loadInto(ed as any, "<p>第一章正文</p>");
    loadInto(ed as any, "<p>第二章正文</p>");
    ed.commands.undo();
    expect(ed.getText()).toBe("第二章正文");
    expect(updates).toEqual([]);
    // 正常输入仍然可以撤销
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "，接着写");
    expect(ed.getText()).toBe("第二章正文，接着写");
    ed.commands.undo();
    expect(ed.getText()).toBe("第二章正文");
    ed.destroy();
  });
});

describe("AI 标记", () => {
  it("切章再切回来、恢复旧版，浅黄底和虚线都还在，AI 占比不归零", async () => {
    const { AiText, AiEdit, AiTracker, aiChars } = await import("../../components/aiMarks");
    const { setDoc } = await import("../editorText");
    const ed = new Editor({ element: document.createElement("div"), extensions: [StarterKit, AiText, AiEdit, AiTracker], content: "" });
    const ch1 = '<p>作者写的<span class="ai">AI写的</span></p><p><span class="aied">AI写后改过</span></p>';
    loadInto(ed as any, ch1);
    expect(aiChars(ed.state.doc)).toEqual([3, 5]);
    const saved = ed.getHTML();
    loadInto(ed as any, "<p>第二章</p>");
    loadInto(ed as any, saved);
    expect(aiChars(ed.state.doc)).toEqual([3, 5]);
    expect(ed.getHTML()).toBe(saved);
    setDoc(ed as any, saved, true);
    expect(aiChars(ed.state.doc)).toEqual([3, 5]);
    // 作者自己打字仍然会把所在段落的 AI 字变成“改过”
    ed.commands.insertContentAt(2, "嗯");
    expect(aiChars(ed.state.doc)).toEqual([0, 8]);
    ed.destroy();
  });
});
