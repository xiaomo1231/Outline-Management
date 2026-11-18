// 「AI 处理选中」发请求时记下的那段原文位置。
// AI 生成要好几秒，这期间作者可能还在别处打字：位置要跟着每一次改动挪，
// 应用结果时再核对原文还在不在，不在就不动正文，让作者重新选。
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";

export type AiRange = { from: number; to: number; orig: string };

export const aiRangeKey = new PluginKey<AiRange | null>("aiRange");

/** 把记下的位置按这次改动挪过去：前后插进来的字不算进原文 */
export function mapAiRange(r: AiRange | null, tr: Transaction): AiRange | null {
  if (!r || !tr.docChanged) return r;
  const from = tr.mapping.map(r.from, 1);
  const to = Math.max(from, tr.mapping.map(r.to, -1));
  return { ...r, from, to };
}

export const AiRangeTrack = Extension.create({
  name: "aiRange",
  addProseMirrorPlugins() {
    return [
      new Plugin<AiRange | null>({
        key: aiRangeKey,
        state: {
          init: () => null,
          apply: (tr, v) => {
            const m = tr.getMeta(aiRangeKey) as AiRange | null | undefined;
            return m !== undefined ? m : mapAiRange(v, tr);
          },
        },
      }),
    ];
  },
});

/** 记下要交给 AI 的这段原文（不进撤销记录） */
export function markAiRange(state: EditorState, from: number, to: number): Transaction {
  return state.tr.setMeta(aiRangeKey, { from, to, orig: state.doc.textBetween(from, to, "\n") }).setMeta("addToHistory", false);
}

/** 原文还原样在：返回它现在的位置；被改过、删掉了（或换了章）返回 null */
export function aiRangeNow(state: EditorState): { from: number; to: number } | null {
  const r = aiRangeKey.getState(state);
  if (!r || r.to > state.doc.content.size) return null;
  if (state.doc.textBetween(r.from, r.to, "\n") !== r.orig) return null;
  return { from: r.from, to: r.to };
}
