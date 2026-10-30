// 正文里 AI 写的字用 aitext 标记（浅黄底）；作者改过的 AI 段落变成 aiedit（只留虚线）。
// 作者自己打的字永远不带标记，所以 AI 占比是准的。
import { Mark, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

export const AiText = Mark.create({
  name: "aitext",
  inclusive: false,
  parseHTML: () => [{ tag: "span.ai" }],
  renderHTML: () => ["span", { class: "ai" }, 0],
});

export const AiEdit = Mark.create({
  name: "aiedit",
  inclusive: false,
  parseHTML: () => [{ tag: "span.aied" }],
  renderHTML: () => ["span", { class: "aied" }, 0],
});

export const AI_META = "moshu-ai";

export const AiTracker = Extension.create({
  name: "aiTracker",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("aiTracker"),
        appendTransaction(trs, _old, state) {
          const user = trs.filter((t) => t.docChanged && !t.getMeta(AI_META));
          if (!user.length) return null;
          const ai = state.schema.marks.aitext;
          const ed = state.schema.marks.aiedit;
          const ranges: [number, number][] = [];
          for (const t of user)
            t.steps.forEach((step, i) => {
              const after = t.mapping.slice(i + 1);
              step.getMap().forEach((_a, _b, from, to) => ranges.push([after.map(from, -1), after.map(to, 1)]));
            });
          const tr = state.tr;
          let changed = false;
          for (const [from, to] of ranges) {
            // 作者新打的字不带 AI 标记
            if (to > from) {
              tr.removeMark(from, to, ai);
              tr.removeMark(from, to, ed);
              changed = true;
            }
            // 被改动的段落里，剩下的 AI 字变成“AI 写后作者改过”
            const $f = state.doc.resolve(Math.min(from, state.doc.content.size));
            const para = $f.depth ? $f.node(1) : null;
            if (!para) continue;
            const start = $f.before(1);
            para.descendants((n: PMNode, pos: number) => {
              if (n.isText && n.marks.some((m) => m.type === ai)) {
                const a = start + 1 + pos;
                tr.removeMark(a, a + n.nodeSize, ai);
                tr.addMark(a, a + n.nodeSize, ed.create());
                changed = true;
              }
            });
          }
          if (!changed) return null;
          tr.setMeta(AI_META, true);
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});

/** 统计 AI 字数：[AI 原样, AI 改过] */
export function aiChars(doc: PMNode): [number, number] {
  let a = 0;
  let e = 0;
  doc.descendants((n) => {
    if (!n.isText) return;
    const len = (n.text || "").replace(/\s/g, "").length;
    if (n.marks.some((m) => m.type.name === "aitext")) a += len;
    else if (n.marks.some((m) => m.type.name === "aiedit")) e += len;
  });
  return [a, e];
}
