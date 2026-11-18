import type { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { AI_META } from "../components/aiMarks";

/** 换掉整章内容，并清空撤销记录。不清的话，Ctrl+Z 会退回上一章的正文并存进这一章 */
export function loadInto(ed: Editor, html: string) {
  setDoc(ed, html, false);
  const s = ed.state;
  ed.view.updateState(EditorState.create({ doc: s.doc, plugins: s.plugins, selection: s.selection }));
}

/** 整章换内容（载入、恢复旧版）。标成“不是作者输入”，正文里原有的 AI 标记原样保留 */
export function setDoc(ed: Editor, html: string, emitUpdate: boolean) {
  ed.chain()
    .command(({ tr }) => {
      tr.setMeta(AI_META, true);
      return true;
    })
    .setContent(html, emitUpdate)
    .run();
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
