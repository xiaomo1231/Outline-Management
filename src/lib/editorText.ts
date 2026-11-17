import type { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";

/** 换掉整章内容，并清空撤销记录。不清的话，Ctrl+Z 会退回上一章的正文并存进这一章 */
export function loadInto(ed: Editor, html: string) {
  ed.commands.setContent(html, false);
  const s = ed.state;
  ed.view.updateState(EditorState.create({ doc: s.doc, plugins: s.plugins, selection: s.selection }));
}

/** 发文格式：每段首行两个全角空格，段间空一行，去掉 AI 标记 */
export function publishText(plain: string): string {
  return plain
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => "\u3000\u3000" + p)
    .join("\n\n");
}
