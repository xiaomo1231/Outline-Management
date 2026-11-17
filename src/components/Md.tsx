// 很小的 Markdown 显示：只认粗体、标题、列表，够 AI 回答用。不解析 HTML，安全。
import type { ReactNode } from "react";

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
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((x, i) => <li key={i}>{inline(x)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const ul = /^\s*[-*•]\s+(.*)$/.exec(l);
    const ol = /^\s*\d+[.、)]\s*(.*)$/.exec(l);
    if (ul || ol) {
      const ordered = !ul;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
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
