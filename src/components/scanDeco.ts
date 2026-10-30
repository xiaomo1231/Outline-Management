import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { PATTERNS } from "../lib/aiscan";

export const scanKey = new PluginKey<boolean>("scan");

/** 套话高亮：只是装饰，不改正文 */
export const ScanHighlight = Extension.create({
  name: "scanHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: scanKey,
        state: {
          init: () => false,
          apply: (tr, v) => (tr.getMeta(scanKey) ?? v) as boolean,
        },
        props: {
          decorations(state) {
            if (!scanKey.getState(state)) return null;
            const decos: Decoration[] = [];
            state.doc.descendants((n, pos) => {
              if (!n.isText || !n.text) return;
              for (const p of PATTERNS) {
                p.re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = p.re.exec(n.text))) decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: "cliche", title: p.label }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
