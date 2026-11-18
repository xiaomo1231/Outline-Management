// 查找替换：本章在编辑器里做，全书的其他章直接改存好的正文。
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseHtml } from "./util";

export interface Hit {
  from: number;
  to: number;
}

/** 编辑器文档里所有命中位置（不跨段，和普通编辑器一致） */
export function findInDoc(doc: PMNode, q: string): Hit[] {
  const out: Hit[] = [];
  if (!q) return out;
  doc.descendants((n, pos) => {
    if (!n.isTextblock) return true;
    // 一个段落里可能有好几个文字节点（AI 标记会切开），拼起来再找
    let text = "";
    const map: number[] = [];
    n.forEach((c, off) => {
      if (c.isText) {
        for (let i = 0; i < c.text!.length; i++) map.push(pos + 1 + off + i);
        text += c.text;
      } else {
        // 软换行等非文字节点占一个位置，命中不会跨过它
        map.push(pos + 1 + off);
        text += "\n";
      }
    });
    let i = text.indexOf(q);
    while (i >= 0) {
      out.push({ from: map[i], to: map[i + q.length - 1] + 1 });
      i = text.indexOf(q, i + q.length);
    }
    return false;
  });
  return out;
}

export function countIn(text: string, q: string): number {
  if (!q) return 0;
  let n = 0;
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) n++;
  return n;
}

/** 在一段文字里找命中的上下文片段 */
export function snippets(text: string, q: string, max = 3): string[] {
  const out: string[] = [];
  if (!q) return out;
  for (let i = text.indexOf(q); i >= 0 && out.length < max; i = text.indexOf(q, i + q.length)) {
    out.push((i > 12 ? "…" : "") + text.slice(Math.max(0, i - 12), i + q.length + 12).replace(/\n/g, " ") + (i + q.length + 12 < text.length ? "…" : ""));
  }
  return out;
}

/** 替换存好的正文 HTML 里的文字（只动文字，不动标签） */
export function replaceInHtml(html: string, q: string, rep: string): { html: string; n: number } {
  if (!q) return { html, n: 0 };
  // 用不挂在页面上的文档解析，正文里夹带的脚本、onerror 不会执行
  const d = parseHtml(html);
  let n = 0;
  // 先按段落处理，命中被 AI 标记切开时也能换
  d.querySelectorAll("p").forEach((p) => {
    const t = lineText(p);
    const k = countIn(t, q);
    if (!k) return;
    n += k;
    const nodes: Text[] = [];
    const w = d.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let x = w.nextNode(); x; x = w.nextNode()) nodes.push(x as Text);
    // 能在单个文字节点里换的直接换
    let left = k;
    for (const tn of nodes) {
      const c = countIn(tn.data, q);
      if (c) {
        tn.data = tn.data.split(q).join(rep);
        left -= c;
      }
    }
    // 跨节点的命中：整段合成文字再换（会丢掉这一段的 AI 底色），软换行保留
    if (left > 0) {
      p.replaceChildren();
      t.split("\n").forEach((line, i) => {
        if (i) p.appendChild(d.ownerDocument.createElement("br"));
        p.appendChild(d.ownerDocument.createTextNode(line.split(q).join(rep)));
      });
    }
  });
  return { html: d.innerHTML, n };
}

/** 段落文字，软换行 <br> 记成换行，查找不跨行 */
function lineText(p: Element): string {
  let s = "";
  const w = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let x = w.nextNode(); x; x = w.nextNode()) {
    if (x.nodeType === 3) s += (x as Text).data;
    else if ((x as Element).tagName === "BR") s += "\n";
  }
  return s;
}
