// 页面顶部的「怎么用」小引导：第一次进来展开，点「知道了」收起，之后点「怎么用？」还能再打开。
import type { ReactNode } from "react";
import { useSetting } from "../lib/hooks";

export function Guide({ id, title, steps, tip }: { id: string; title: string; steps: ReactNode[]; tip?: ReactNode }) {
  const [seen, setSeen, ready] = useSetting<Record<string, number>>("guides", {});
  if (!ready) return null;
  const open = !seen[id];
  if (!open)
    return (
      <button type="button" className="guide-open" onClick={() => setSeen({ ...seen, [id]: 0 })}>
        怎么用？
      </button>
    );
  return (
    <div className="guide" role="note">
      <div className="guide-h">
        <b>{title}</b>
        <button type="button" className="btn" onClick={() => setSeen({ ...seen, [id]: 1 })}>
          知道了
        </button>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {tip && <p className="guide-tip">{tip}</p>}
    </div>
  );
}
