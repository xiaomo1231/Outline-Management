// 选区相关的显示效果，全部用编辑器装饰来画，不直接改正文的 DOM。
// 直接给段落加 class 会被编辑器当成正文被改了，整段重画，拖选时选区就会闪、会丢。
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const keepSelKey = new PluginKey<boolean>("keepSel");

/** 光标所在的那一段（专注模式用）加 active */
function activePara(state: EditorState): Decoration | null {
  const $f = state.selection.$from;
  if ($f.depth < 1) return null;
  const at = $f.before(1);
  const node = state.doc.nodeAt(at);
  return node ? Decoration.node(at, at + node.nodeSize, { class: "active" }) : null;
}

export const SelectionUi = Extension.create({
  name: "selectionUi",
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: keepSelKey,
        // 右键菜单开着时，焦点在菜单的输入框里，正文的选中底色会被浏览器收起；
        // 这时用 sel-keep 在原选区上画一层一样的底色
        state: {
          init: () => false,
          apply: (tr, v) => (tr.getMeta(keepSelKey) ?? v) as boolean,
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const p = activePara(state);
            if (p) decos.push(p);
            const { from, to, empty } = state.selection;
            if (keepSelKey.getState(state) && !empty) decos.push(Decoration.inline(from, to, { class: "sel-keep" }));
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },
});
