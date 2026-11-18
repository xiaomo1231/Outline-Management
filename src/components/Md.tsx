// 很小的 Markdown 显示：只认粗体、标题、列表，够 AI 回答用。不解析 HTML，安全。
import { Fragment, type ReactNode } from "react";

function inline(t: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index));
    out.push(m[1] != null ? <b key={m.index}>{m[1]}</b> : <code key={m.index}>{m[2]}</code>);
    last = re.lastIndex;
  }
  if (last < t.length) out.push(t.slice(last));
  return out;
}

export function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    // 列表项下面缩进的说明行用换行接在这一项里
    const items = list.items.map((x, i) => <li key={i}>{x.split("\n").map((y, j) => <Fragment key={j}>{j > 0 && <br />}{inline(y)}</Fragment>)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} start={list.start}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(l);
    // 序号后面紧跟数字的不是列表：2023.10.1、3.5倍
    const ol = /^\s*(\d+)[.、)](?!\d)\s*(.*)$/.exec(l);
    if (ul || ol) {
      const ordered = !ul;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, start: ol ? +ol[1] : 1, items: [] };
      list.items.push(ul ? ul[1] : ol![2]);
      continue;
    }
    // 列表项之间的空行、缩进的说明行不打断列表，编号接着往下
    if (list && !l.trim()) continue;
    if (list && /^\s+\S/.test(l)) {
      list.items[list.items.length - 1] += "\n" + l.trim();
      continue;
    }
    flush();
    const h = /^#{1,6}\s+(.*)$/.exec(l);
    if (h) blocks.push(<p key={blocks.length} className="md-h">{inline(h[1])}</p>);
    else if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) blocks.push(<hr key={blocks.length} />);
    else if (l.trim()) blocks.push(<p key={blocks.length}>{inline(l)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}
