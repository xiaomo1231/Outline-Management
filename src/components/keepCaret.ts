// 打字时自动往下翻：光标离可视区域底部太近（或已经跑到外面）就把页面往上推，
// 让正在写的那一行停在离底部大约四分之一屏的地方。只在内容变了的时候动，单纯点一下不会跳。
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** 光标下沿离可视区底部至少留这么多 */
export function bottomMargin(viewHeight: number): number {
  return Math.max(120, Math.round(viewHeight * 0.25));
}

/**
 * 需要往下翻多少像素（0 表示不用翻）。
 * caretTop / caretBottom 和 viewTop / viewBottom 都是同一坐标系（屏幕坐标）。
 */
export function scrollDelta(caretTop: number, caretBottom: number, viewTop: number, viewBottom: number): number {
  const m = bottomMargin(viewBottom - viewTop);
  const limit = viewBottom - m;
  if (caretBottom <= limit) return 0;
  // 不要把光标那一行推出顶部
  return Math.max(0, Math.min(caretBottom - limit, caretTop - viewTop - 8));
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function keepVisible(view: EditorView) {
  if (!view.hasFocus()) return;
  let c: { top: number; bottom: number };
  try {
    c = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const box = scrollParent(view.dom);
  const top = box ? box.getBoundingClientRect().top : 0;
  const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
  const d = scrollDelta(c.top, c.bottom, top, bottom);
  if (d <= 0) return;
  if (box) box.scrollBy({ top: d });
  else window.scrollBy({ top: d });
}

export const KeepCaret = Extension.create({
  name: "keepCaret",
  addProseMirrorPlugins() {
    let raf = 0;
    const later = (view: EditorView) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => keepVisible(view));
    };
    return [
      new Plugin({
        key: new PluginKey("keepCaret"),
        props: {
          handleDOMEvents: {
            // 中文输入法上屏时也要跟上
            compositionend: (view) => {
              later(view);
              return false;
            },
          },
        },
        view: () => ({
          update: (view, prev) => {
            if (!prev.doc.eq(view.state.doc)) later(view);
          },
          destroy: () => cancelAnimationFrame(raf),
        }),
      }),
    ];
  },
});
