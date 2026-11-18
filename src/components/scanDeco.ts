import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { PATTERNS } from "../lib/aiscan";
import type { LimitHit } from "../lib/limits";

export const scanKey = new PluginKey<boolean>("scan");

/** 写作限制的扫描，由写作页设置：传入整章纯文本（段落之间用换行），返回违反的位置 */
type LimitScan = (text: string) => (LimitHit & { title: string })[];
let limitScan: LimitScan = () => [];
export function setLimitScan(fn: LimitScan) {
  limitScan = fn;
}

/** 整章纯文本，以及每一段文字在文档里的位置，用来把纯文本里的位置换回文档位置 */
export function docText(doc: PMNode): { text: string; at: (i: number) => number } {
  const segs: { start: number; pos: number; len: number }[] = [];
  let text = "";
  let first = true;
  doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    if (!first) text += "\n";
    first = false;
    n.forEach((c, off) => {
      if (c.isText && c.text) {
        segs.push({ start: text.length, pos: pos + 1 + off, len: c.text.length });
        text += c.text;
      }
    });
    return false;
  });
  const at = (i: number) => {
    for (const s of segs) if (i >= s.start && i <= s.start + s.len) return s.pos + (i - s.start);
    return -1;
  };
  return { text, at };
}

/** 套话和写作限制高亮：只是装饰，不改正文 */
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
            // 按整段文字匹配再换回文档位置：加粗、AI 标记会把一段拆成几个文本节点，逐个节点匹配会漏掉跨节点的套话
            const { text, at } = docText(state.doc);
            for (const p of PATTERNS) {
              p.re.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = p.re.exec(text))) {
                const a = at(m.index);
                const b = at(m.index + m[0].length);
                if (a >= 0 && b > a) decos.push(Decoration.inline(a, b, { class: "cliche", title: p.label }));
              }
            }
            for (const h of limitScan(text)) {
              const a = at(h.from);
              const b = at(h.to);
              if (a >= 0 && b > a) decos.push(Decoration.inline(a, b, { class: "lim-hit" + (h.unsure ? " unsure" : ""), title: h.title }));
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
