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
